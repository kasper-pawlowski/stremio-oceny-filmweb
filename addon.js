const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

const manifest = {
    id: 'community.oceny-filmweb',
    version: '1.0.0',
    catalogs: [],
    resources: ['meta'],
    types: ['movie', 'series'],
    name: 'Oceny Filmweb',
    description: 'Dodaje oceny widzów i krytyków z portalu Filmweb',
    idPrefixes: ['tt'],
    logo: 'https://www.filmweb.pl/favicon.ico',
};
const builder = new addonBuilder(manifest);

const axiosConfig = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
};

// 1. FUNKCJA DO POBIERANIA ID Z WIKIDATA
async function getFilmwebIdFromWikidata(imdbId) {
    try {
        console.log(`Pytam Wikidata o Filmweb ID dla: ${imdbId}`);
        const sparqlQuery = `
        SELECT ?textId ?filmId ?seriesId WHERE {
          ?item wdt:P345 "${imdbId}".
          OPTIONAL { ?item wdt:P3995 ?textId. }
          OPTIONAL { ?item wdt:P5032 ?filmId. }
          OPTIONAL { ?item wdt:P5288 ?seriesId. }
        }`;

        const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}&format=json`;

        const response = await axios.get(url, {
            headers: { 'User-Agent': 'StremioFilmwebAddon/1.0 (https://github.com/stremio)' },
        });

        const bindings = response.data.results.bindings;
        if (bindings && bindings.length > 0) {
            return {
                textId: bindings[0].textId ? bindings[0].textId.value : null,
                filmId: bindings[0].filmId ? bindings[0].filmId.value : null,
                seriesId: bindings[0].seriesId ? bindings[0].seriesId.value : null,
            };
        }
    } catch (error) {
        console.error('Błąd Wikidata:', error.message);
    }
    return null;
}

// 2. GŁÓWNA LOGIKA SCRAPERA
async function getFilmwebData(imdbId, type) {
    try {
        const ids = await getFilmwebIdFromWikidata(imdbId);

        if (!ids || (!ids.textId && !ids.filmId && !ids.seriesId)) {
            console.log('Nie znaleziono powiązania w bazie Wikidata dla tego tytułu.');
            return null;
        }

        let movieUrl;
        let resolvedTextId = ids.textId;

        if (ids.filmId && !/^\d+$/.test(ids.filmId)) resolvedTextId = ids.filmId;
        if (ids.seriesId && !/^\d+$/.test(ids.seriesId)) resolvedTextId = ids.seriesId;

        if (resolvedTextId) {
            movieUrl = `https://www.filmweb.pl/${resolvedTextId}`;
        } else if (ids.seriesId) {
            movieUrl = `https://www.filmweb.pl/serial?Id=${ids.seriesId}`;
        } else if (ids.filmId) {
            movieUrl = `https://www.filmweb.pl/film?Id=${ids.filmId}`;
        } else {
            return null;
        }

        console.log(`Znalazłem ID! Wchodzę na: ${movieUrl}`);

        const movieResponse = await axios.get(movieUrl, axiosConfig);
        const $$ = cheerio.load(movieResponse.data);

        // -- OCENA WIDZÓW --
        let rating = $$('.filmRating__rateValue').first().text().trim();
        if (!rating) rating = '?';
        else rating = rating.replace(',', '.');

        // -- OCENA KRYTYKÓW --
        let criticsRating = $$('.filmRating--filmCritic .filmRating__rateValue').first().text().trim();
        if (!criticsRating) criticsRating = '?';
        else criticsRating = criticsRating.replace(',', '.');

        return {
            rating: rating,
            critics: criticsRating,
            url: movieUrl,
        };
    } catch (error) {
        console.error('Błąd scrapera Filmwebu:', error.message);
        return null;
    }
}

// 3. OBSŁUGA ZAPYTAŃ OD STREMIO
builder.defineMetaHandler(async ({ type, id }) => {
    console.log(`\n--- Przechwycono zapytanie o: ${type} ${id} ---`);
    let meta = { id, type };

    try {
        const cinemetaUrl = `https://v3-cinemeta.strem.io/meta/${type}/${id}.json`;
        const response = await axios.get(cinemetaUrl);

        if (response.data && response.data.meta) {
            meta = response.data.meta;
        }

        const originalLinks = meta.links || [];

        if (id && id.startsWith('tt')) {
            const fwData = await getFilmwebData(id, type);

            if (fwData) {
                meta.links = [
                    {
                        name: `⭐ ${fwData.rating}\u00A0\u00A0\u00A0\u00A0\u00A0|\u00A0\u00A0\u00A0\u00A0\u00A0🍅 ${fwData.critics}`,
                        category: 'Filmweb',
                        url: fwData.url,
                    },
                    ...originalLinks,
                ];
            } else {
                meta.links = originalLinks;
            }
        } else {
            meta.links = originalLinks;
        }

        return Promise.resolve({ meta, cacheMaxAge: 86400 });
    } catch (error) {
        console.error('Błąd podczas obsługi meta:', error.message);
        return Promise.resolve({ meta });
    }
});

module.exports = builder.getInterface();
