const axios = require('axios');
const NodeCache = require('node-cache');

const filmwebCache = new NodeCache({ stdTTL: 43200 });

const manifest = {
    id: 'community.oceny-filmweb',
    version: '2.0.0',
    catalogs: [],
    resources: ['stream'],
    types: ['movie', 'series'],
    name: 'Oceny Filmweb',
    description: 'Dodaje oceny widzów i krytyków z portalu Filmweb',
    idPrefixes: ['tt'],
    logo: 'https://www.filmweb.pl/favicon.ico',
    behaviorHints: { configurable: false },
};

async function getCinemetaDetails(imdbId, type) {
    console.log(`[Cinemeta] Pobieram dane dla ${imdbId} (${type}).`);
    try {
        const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'OcenyFilmwebStremioAddon/1.0',
                Accept: 'application/json',
            },
            timeout: 5000,
        });

        const meta = response.data && response.data.meta;

        if (!meta) {
            console.warn(`[Cinemeta] Brak danych meta w odpowiedzi dla ${imdbId}`);
            return null;
        }

        console.log(`[Cinemeta] Odpowiedź dla ${imdbId}:`, meta.imdb_id || meta.id, meta.name, meta.type);

        return {
            imdb_id: meta.imdb_id || meta.id,
            name: meta.name,
            year: meta.year,
            type: meta.type,
        };
    } catch (error) {
        console.error(`[Cinemeta Error] Nie można pobrać danych dla ${imdbId}:`, error.message);
        return null;
    }
}

async function checkFilmwebYear(filmwebId) {
    try {
        const searchUrl = `https://www.filmweb.pl/api/v1/title/${filmwebId}/info`;
        const searchRes = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        });

        return searchRes.data.year;
    } catch (error) {
        console.error(`[Filmweb Year Error] Nie można pobrać roku produkcji dla Filmweb ID ${filmwebId}:`, error.message);
        return null;
    }
}

async function searchFilmwebFallback(imdbId, type) {
    const cinemetaData = await getCinemetaDetails(imdbId, type);

    if (!cinemetaData || !cinemetaData.name || !cinemetaData.year) {
        console.log(`[Fallback] Brak wystarczających danych z Cinemeta dla ${imdbId}, nie można kontynuować.`);
        return null;
    }

    console.log(`[Fallback] Szukam: "${cinemetaData.name}" (Oczekiwany rok: ${cinemetaData.year})`);

    try {
        const searchUrl = `https://www.filmweb.pl/api/v1/search?query=${encodeURIComponent(cinemetaData.name)}`;
        const searchRes = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        });

        const hits = searchRes.data.searchHits || [];

        const expectedType = type === 'movie' ? 'film' : 'serial';
        const potentialMatches = hits.filter((hit) => hit.type === expectedType);

        const targetYear = parseInt(String(cinemetaData.year).split('-')[0], 10);

        for (const match of potentialMatches.slice(0, 3)) {
            const filmwebYear = parseInt(await checkFilmwebYear(match.id), 10);

            if (filmwebYear && !isNaN(targetYear) && Math.abs(filmwebYear - targetYear) <= 1) {
                console.log(`[Fallback] Sukces! Znaleziono ID: ${match.id}`);

                const finalId = match.id.toString();

                filmwebCache.set(imdbId, finalId);

                return finalId;
            }
        }

        console.log(`[Fallback] Odmowa. Znaleziono wyniki, ale żaden nie pasuje do roku ${cinemetaData.year}.`);
        return null;
    } catch (error) {
        console.error(`[Fallback Error] Błąd podczas szukania "${cinemetaData.name}":`, error.message);
        return null;
    }
}

async function getFilmwebRatings(filmwebId) {
    console.log(`[Ratings] Pobieram oceny dla Filmweb ID ${filmwebId}... `);
    try {
        const usersRatingsUrl = `https://www.filmweb.pl/api/v1/film/${filmwebId}/rating`;
        const criticsRatingsUrl = `https://www.filmweb.pl/api/v1/film/${filmwebId}/critics/rating`;

        const [usersRes, criticsRes] = await Promise.all([
            axios.get(usersRatingsUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }),
            axios.get(criticsRatingsUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }),
        ]);

        const usersRating = usersRes.data.rate || null;
        const usersCount = usersRes.data.count || 0;
        const criticsRating = criticsRes.data.rate || null;
        const criticsVotes = criticsRes.data.count || 0;
        return { usersRating, usersCount, criticsRating, criticsVotes };
    } catch (error) {
        console.error(`[Ratings Error] Nie można pobrać ocen dla Filmweb ID ${filmwebId}:`, error.message);
        return null;
    }
}

async function getFilmwebIdFromImdb(imdbId) {
    const cachedId = filmwebCache.get(imdbId);
    if (cachedId) {
        console.log(`[Cache] Pobrano Filmweb ID (${cachedId}) dla ${imdbId}`);
        return cachedId;
    }

    try {
        console.log(`[Wikidata] Szukam Filmweb ID dla ${imdbId}...`);
        const sparqlQuery = `
        SELECT ?filmId ?seriesId ?textId WHERE {
          ?item wdt:P345 "${imdbId}".
          OPTIONAL { ?item wdt:P5032 ?filmId. }
          OPTIONAL { ?item wdt:P5288 ?seriesId. }
          OPTIONAL { ?item wdt:P3995 ?textId. }
        }`;

        const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}&format=json`;

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'OcenyFilmwebStremioAddon/1.0',
                Accept: 'application/sparql-results+json',
            },
            timeout: 5000,
        });

        const bindings = response.data.results.bindings;

        if (bindings && bindings.length > 0) {
            const result = bindings[0];
            let rawFilmwebId = null;

            if (result.filmId) rawFilmwebId = result.filmId.value;
            else if (result.seriesId) rawFilmwebId = result.seriesId.value;
            else if (result.textId) rawFilmwebId = result.textId.value;

            if (rawFilmwebId) {
                if (/^\d+$/.test(rawFilmwebId)) {
                    filmwebCache.set(imdbId, rawFilmwebId);
                    console.log(`[Wikidata] Znaleziono czyste ID: ${rawFilmwebId}`);
                    return rawFilmwebId;
                } else {
                    console.log(`[Redirect] Wykryto tekstowe ID: ${rawFilmwebId}. Rozwiązuję adres...`);
                    try {
                        const fwRes = await axios.get(`https://www.filmweb.pl/${rawFilmwebId}`, {
                            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                        });

                        const finalUrl = fwRes.request.res.responseUrl;

                        const match = finalUrl.match(/-(\d+)$/);

                        if (match) {
                            const finalId = match[1];
                            filmwebCache.set(imdbId, finalId);
                            console.log(`[Redirect] Sukces! Prawdziwe ID to: ${finalId}`);
                            return finalId;
                        }
                    } catch (redirectError) {
                        console.error(`[Redirect Error] Nie udało się rozwiązać linku dla ${rawFilmwebId}:`, redirectError.message);
                    }
                }
            }
        }

        console.log(`[Wikidata] Brak wyników dla ${imdbId}`);
        return null;
    } catch (error) {
        console.error(`[Wikidata Error] Błąd dla ${imdbId}:`, error.message);
        return null;
    }
}

function formatRating(rate) {
    if (!rate) return '?';
    return (Math.round(rate * 10) / 10).toFixed(1).replace('.', ',');
}

function formatUsersCount(count) {
    if (!count) return '0 ocen';

    if (count >= 1000) {
        let tysiace = (count / 1000).toFixed(1).replace('.', ',');
        if (tysiace.endsWith(',0')) {
            tysiace = tysiace.slice(0, -2);
        }
        return `${tysiace} tys. ocen`;
    }

    if (count === 1) return '1 ocena';

    const resztaDziesietna = count % 10;
    const resztaSetna = count % 100;

    if (resztaDziesietna >= 2 && resztaDziesietna <= 4 && (resztaSetna < 12 || resztaSetna > 14)) {
        return `${count} oceny`;
    }

    return `${count} ocen`;
}

function formatCriticsCount(count) {
    if (!count) return '0 krytyków';
    if (count === 1) return '1 krytyk';

    return `${count} krytyków`;
}

function getCriticEmoji(rate) {
    if (!rate) return '⬜'; // Szary/Biały dla braku ocen
    if (rate >= 6.0) return '🟩'; // Pozytywne
    if (rate >= 4.0) return '🟨'; // Mieszane
    return '🟥'; // Negatywne
}

async function handleStream(type, id) {
    const cleanImdbId = id.split(':')[0];

    if (!cleanImdbId.startsWith('tt')) {
        return { streams: [] };
    }

    let filmwebId = await getFilmwebIdFromImdb(cleanImdbId);

    if (!filmwebId) {
        filmwebId = await searchFilmwebFallback(cleanImdbId, type);
    }

    if (!filmwebId) {
        filmwebCache.set(cleanImdbId, 'NOT_FOUND');
        return { streams: [] };
    }

    const ratings = await getFilmwebRatings(filmwebId);

    const fUsersRate = formatRating(ratings.usersRating);
    const fUsersCount = formatUsersCount(ratings.usersCount);

    const fCriticsRate = ratings.criticsRating ? formatRating(ratings.criticsRating) : '?';
    const fCriticsCount = formatCriticsCount(ratings.criticsVotes);

    const finalDescription = `⭐ ${fUsersRate}  (${fUsersCount})\n${getCriticEmoji(ratings.criticsRating)} ${fCriticsRate}  (${fCriticsCount})`;

    const fwType = type === 'series' ? 'serial' : 'film';

    return {
        streams: [
            {
                name: '🟡 Filmweb',
                description: finalDescription,
                externalUrl: `https://www.filmweb.pl/${fwType}/tytul-0-${filmwebId}`,
            },
        ],
    };
}

module.exports = { manifest, handleStream };
