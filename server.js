const express = require('express');
const addon = require('./addon');

const app = express();
const port = process.env.PORT || 8000;

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');
    next();
});

app.get('/manifest.json', (req, res) => res.json(addon.manifest));

app.get('/stream/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;

    try {
        const streamResponse = await addon.handleStream(type, id);
        res.json(streamResponse);
    } catch (error) {
        console.error(`Błąd krytyczny serwera dla ${id}:`, error.message);
        res.json({ streams: [] });
    }
});

app.listen(port, () => {
    console.log(`Serwer działa! Dodaj do Stremio link: http://localhost:${port}/manifest.json`);
});

module.exports = app;
