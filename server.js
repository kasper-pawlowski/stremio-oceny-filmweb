const express = require('express');
const addon = require('./addon');

const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');
    next();
});

app.get('/', (req, res) => res.redirect('/configure'));
app.get('/aio/:aioId/configure', (req, res) => res.redirect('/configure')); // <- TA LINIJKA NAPRAWIA ZĘBATKĘ

app.get('/configure', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Konfiguracja Oceny Filmweb</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; padding: 50px; background-color: #121212; color: #fff; }
                .container { max-width: 450px; margin: auto; background: #1e1e1e; padding: 30px; border-radius: 12px; box-shadow: 0 8px 16px rgba(0,0,0,0.5); }
                h2 { color: #e5a00d; margin-top: 0; }
                input[type="text"] { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #333; border-radius: 6px; background: #2a2a2a; color: #fff; box-sizing: border-box; }
                .link-box { background: #111; color: #4CAF50; text-align: center; cursor: pointer; font-weight: bold; border: 1px solid #4CAF50; }
                .checkbox-container { display: flex; align-items: center; margin: 20px 0; cursor: pointer; color: #e5a00d; font-weight: bold; }
                .checkbox-container input { width: 20px; height: 20px; margin-right: 10px; cursor: pointer; }
                #aioBox { display: none; text-align: left; background: #252525; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
                
                /* Nowe style dla przycisków */
                .btn-group { display: flex; gap: 10px; margin-top: 15px; }
                button { border: none; padding: 14px; font-weight: bold; border-radius: 6px; cursor: pointer; transition: background 0.3s; font-size: 15px; color: white; }
                .btn-install { background-color: #8a5aeb; flex: 2; }
                .btn-install:hover { background-color: #7044c4; }
                .btn-copy { background-color: #333; flex: 1; }
                .btn-copy:hover { background-color: #555; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Oceny Filmweb</h2>
                <label class="checkbox-container">
                    <input type="checkbox" id="useAio">
                    Połącz z bazą Aiometadata (Opcjonalne)
                </label>
                <div id="aioBox">
                    <label>ID z Twojego linku Aiometadata:</label>
                    <input type="text" id="aioId" placeholder="np. b590b958-af23...">
                </div>
                
                <label style="display:block; text-align:left; margin-top:10px;">Gotowy link instalacyjny:</label>
                <input type="text" id="installLink" class="link-box" readonly onclick="copyInstallLink()">
                
                <div class="btn-group">
                    <button class="btn-install" onclick="installAddon()">🚀 Zainstaluj automatycznie</button>
                    <button class="btn-copy" onclick="copyInstallLink()">📋 Kopiuj link</button>
                </div>
            </div>
            
            <script>
                const useAio = document.getElementById('useAio');
                const aioBox = document.getElementById('aioBox');
                const aioId = document.getElementById('aioId');
                const installLink = document.getElementById('installLink');

                function updateLink() {
                    let url = window.location.origin.replace('127.0.0.1', 'localhost');
                    
                    if (useAio.checked && aioId.value.trim()) {
                        url += '/aio/' + encodeURIComponent(aioId.value.trim());
                    }
                    url += '/manifest.json';
                    
                    installLink.value = url;
                    return url;
                }

                useAio.addEventListener('change', () => {
                    aioBox.style.display = useAio.checked ? 'block' : 'none';
                    updateLink();
                });
                aioId.addEventListener('input', updateLink);
                window.onload = updateLink;

                // FUNKCJA: AUTOMATYCZNA INSTALACJA
                function installAddon() {
                    const url = updateLink();
                    const stremioUrl = url.replace(/^https?:\\/\\//i, 'stremio://');
                    window.location.href = stremioUrl;
                }

                // FUNKCJA: KOPIOWANIE LINKU
                function copyInstallLink() {
                    updateLink();
                    installLink.select();
                    document.execCommand('copy');
                    alert("✅ Skopiowano link! Wklej go do wyszukiwarki dodatków w Stremio.");
                }
            </script>
        </body>
        </html>
    `);
});

// 1. Podstawowe trasy (Tylko Cinemeta)
app.get('/manifest.json', (req, res) => res.json(addon.manifest));
app.get('/meta/:type/:id.json', async (req, res) => {
    const data = await addon.handleMeta(req.params.type, req.params.id, null);
    res.json(data);
});

// 2. Trasy z Aiometadata (Mają prefiks /aio/ID)
app.get('/aio/:aioId/manifest.json', (req, res) => res.json(addon.manifest));
app.get('/aio/:aioId/meta/:type/:id.json', async (req, res) => {
    const data = await addon.handleMeta(req.params.type, req.params.id, req.params.aioId);
    res.json(data);
});

const port = process.env.PORT || 51771;
app.listen(port, () => {
    console.log(`Serwer działa! Otwórz: http://localhost:${port}/configure`);
});
