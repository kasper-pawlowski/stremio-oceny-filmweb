const axios = require('axios');
const cheerio = require('cheerio');

const manifest = {
    id: 'community.oceny-filmweb',
    version: '1.0.0',
    catalogs: [],
    resources: ['meta'],
    types: ['movie', 'series'],
    name: 'Oceny Filmweb',
    description: 'Dodaje oceny widzów i krytyków z portalu Filmweb. Wspiera Aiometadata.',
    idPrefixes: ['tt'],
    logo: 'https://www.filmweb.pl/favicon.ico',
    behaviorHints: { configurable: true },
};

const axiosConfig = {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
};

async function getFilmwebIdFromWikidata(imdbId) {
    try {
        const sparqlQuery = `
        SELECT ?textId ?filmId ?seriesId WHERE {
          ?item wdt:P345 "${imdbId}".
          OPTIONAL { ?item wdt:P3995 ?textId. }
          OPTIONAL { ?item wdt:P5032 ?filmId. }
          OPTIONAL { ?item wdt:P5288 ?seriesId. }
        }`;
        const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}&format=json`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'StremioFilmwebAddon/1.0' } });
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

async function getFilmwebData(imdbId, type) {
    try {
        const ids = await getFilmwebIdFromWikidata(imdbId);
        if (!ids || (!ids.textId && !ids.filmId && !ids.seriesId)) return null;

        let movieUrl;
        let resolvedTextId = ids.textId;
        if (ids.filmId && !/^\d+$/.test(ids.filmId)) resolvedTextId = ids.filmId;
        if (ids.seriesId && !/^\d+$/.test(ids.seriesId)) resolvedTextId = ids.seriesId;

        if (resolvedTextId) movieUrl = `https://www.filmweb.pl/${resolvedTextId}`;
        else if (ids.seriesId) movieUrl = `https://www.filmweb.pl/serial?Id=${ids.seriesId}`;
        else if (ids.filmId) movieUrl = `https://www.filmweb.pl/film?Id=${ids.filmId}`;
        else return null;

        const movieResponse = await axios.get(movieUrl, axiosConfig);
        const $$ = cheerio.load(movieResponse.data);

        let rating = $$('.filmRating__rateValue').first().text().trim() || '?';
        rating = rating.replace(',', '.');

        let criticsRating = $$('.filmRating--filmCritic .filmRating__rateValue').first().text().trim() || '?';
        criticsRating = criticsRating.replace(',', '.');

        return { rating, critics: criticsRating, url: movieUrl };
    } catch (error) {
        return null;
    }
}

async function handleMeta(type, id, aioId) {
    console.log(`\n--- Zapytanie: ${type} ${id} | Aiometadata ID: ${aioId || 'Brak'} ---`);
    let meta = { id, type };

    try {
        let response;

        if (aioId) {
            const metaUrl = `https://aiometadata.elfhosted.com/stremio/${aioId}/meta/${type}/${id}.json`;
            try {
                response = await axios.get(metaUrl);
            } catch (error) {
                console.log('[Błąd] aiometadata padło, powrót do Cinemeta...');
                response = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${id}.json`);
            }
        } else {
            response = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${id}.json`);
        }

        if (response && response.data && response.data.meta) {
            meta = response.data.meta;
        }

        const originalLinks = meta.links || [];

        if (id && id.startsWith('tt')) {
            const fwData = await getFilmwebData(id, type);
            if (fwData) {
                const buttonName =
                    fwData.critics !== '?'
                        ? `⭐ ${fwData.rating}\u00A0\u00A0\u00A0\u00A0\u00A0|\u00A0\u00A0\u00A0\u00A0\u00A0🍅 ${fwData.critics}`
                        : `⭐ ${fwData.rating}\u00A0\u00A0\u00A0\u00A0\u00A0(Filmweb)`;

                meta.links = [{ name: buttonName, category: 'Przejdź na Filmweb', url: fwData.url }, ...originalLinks];
            } else {
                meta.links = originalLinks;
            }
        } else {
            meta.links = originalLinks;
        }

        return { meta, cacheMaxAge: 86400 };
    } catch (error) {
        return { meta };
    }
}

module.exports = { manifest, handleMeta };
