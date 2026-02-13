const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const app = express();

// ==========================================
// 1. DEKRIPSI URL & HELPER
// ==========================================

function wibuDecryptUrl(encryptedHex) {
    try {
        const key = Buffer.from('wibuhub_secret_key_2024').slice(0, 16);
        const iv = Buffer.from('1234567891011121');
        const decipher = crypto.createDecipheriv('aes-128-ctr', key, iv);
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        return null;
    }
}

function wibuUnpackJs(packedJs) {
    const regex = /\}\s*\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/s;
    const match = packedJs.match(regex);
    if (match) {
        let payload = match[1];
        const radix = parseInt(match[2], 10);
        const count = parseInt(match[3], 10);
        const keywords = match[4].split('|');

        for (let i = count - 1; i >= 0; i--) {
            const token = i.toString(radix);
            const replacement = keywords[i] ? keywords[i] : token;
            const regexToken = new RegExp('\\b' + token + '\\b', 'g');
            payload = payload.replace(regexToken, replacement);
        }
        return payload;
    }
    return null;
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// 2. LOGIKA GRABBER SERVER
// ==========================================

async function getStreampoiStream(url) {
    try {
        const { data } = await axios.get(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" }
        });
        const match = data.match(/(eval\(function\(p,a,c,k,e,d\).*?\.split\('\|'\)\)\))/);
        if (match) {
            const unpacked = wibuUnpackJs(match[1]);
            const fileMatch = unpacked?.match(/file:"([^"]+)"/);
            if (fileMatch) return fileMatch[1];
        }
    } catch (e) {}
    return null;
}

async function getDoodstreamStream(targetUrl) {
    const proxies = [
        'http://216.26.238.165:3129', 'http://216.26.240.93:3129', 'http://216.26.250.72:3129',
        'http://216.26.248.235:3129', 'http://104.207.60.200:3129', 'http://45.3.47.145:3129',
        'http://65.111.24.119:3129', 'http://45.3.47.6:3129', 'http://65.111.9.239:3129'
    ];
    const proxyUrl = proxies[Math.floor(Math.random() * proxies.length)];
    const httpsAgent = new HttpsProxyAgent(proxyUrl);
    
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, httpsAgent, httpAgent: httpsAgent }));
    
    let url = targetUrl.replace(/dood\.to|dood\.so|myvidplay\.com/g, 'dood.to');
    const domain = "https://dood.to";
    const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36", "Referer": url };

    try {
        const { data: html } = await client.get(url, { headers });
        const passMatch = html.match(/(\/pass_md5\/[^']+)/);
        
        if (passMatch) {
            const passPath = passMatch[1];
            const token = passPath.split('/').pop();
            
            await delay(2000); 
            
            const { data: baseUrl } = await client.get(domain + passPath, { headers });
            if (baseUrl && baseUrl.includes('http')) {
                const randomString = crypto.randomBytes(5).toString('hex');
                return `${baseUrl}${randomString}?token=${token}&expiry=${Date.now()}`;
            }
        }
    } catch (e) {}
    return null;
}

async function getVidnestStream(url) {
    try {
        const { data } = await axios.get(url);
        const match = data.match(/sources:\s*\[\{\s*file:"([^"]+)"/);
        if (match) return match[1];
    } catch (e) {}
    return null;
}

// ==========================================
// 3. MAIN ROUTES
// ==========================================

// A. Route Utama Player
app.get('/', async (req, res) => {
    let target = req.query.url;
    const id = req.query.id;
    
    if (id) {
        target = wibuDecryptUrl(id);
    }

    let videoSrc = "";
    let streamType = "video/mp4";
    let errorMsg = "";

    if (target) {
        if (target.includes('streampoi') || target.includes('streamruby')) {
            const direct = await getStreampoiStream(target);
            if (direct) {
                videoSrc = `/relay?url=${encodeURIComponent(direct)}&ref=https://streampoi.com/&ori=https://streampoi.com`;
                streamType = "application/x-mpegURL";
            }
        } else if (target.includes('dood') || target.includes('myvidplay')) {
            const direct = await getDoodstreamStream(target);
            if (direct) {
                videoSrc = `/relay?url=${encodeURIComponent(direct)}&ref=https://dood.to/&ori=https://dood.to`;
                streamType = "video/mp4";
            }
        } else if (target.includes('vidnest')) {
            const direct = await getVidnestStream(target);
            if (direct) {
                videoSrc = `/relay?url=${encodeURIComponent(direct)}&ref=https://vidnest.io/&ori=https://vidnest.io`;
                streamType = direct.includes('.m3u8') ? "application/x-mpegURL" : "video/mp4";
            }
        } else {
            errorMsg = "Silahkan gunakan Server Lainya";
        }

        if (!videoSrc) errorMsg = "Gagal mengambil video. Refresh halaman.";
    }

    const html = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WibuPlayer</title>
        <link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css" />
        <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body, html { width: 100%; height: 100%; background: #000; overflow: hidden; font-family: 'Segoe UI', sans-serif; }
        .player-wrapper { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
        .error-message { color: #ff6b6b; text-align: center; background: rgba(30, 30, 30, 0.95); padding: 30px; border-radius: 12px; border: 1px solid #444; max-width: 90%; line-height: 1.6; }
        :root { --plyr-color-main: #8a2be2; }
        .plyr { width: 100%; height: 100%; }
        </style>
    </head>
    <body>
        <div class="player-wrapper">
            ${videoSrc 
                ? `<video id="player" playsinline controls crossorigin></video>`
                : `<div class="error-message">
                    <h3>⚠️ Video Error</h3>
                    <p>${errorMsg}</p>
                    <button onclick="window.location.reload()" style="margin-top:10px; padding:5px 15px; cursor:pointer; background:#8a2be2; color:#fff; border:none; border-radius:5px;">Refresh</button>
                   </div>`
            }
        </div>
        <script src="https://cdn.plyr.io/3.7.8/plyr.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <script>
        document.addEventListener('DOMContentLoaded', () => {
            const video = document.getElementById('player');
            const source = "${videoSrc}";
            const type = "${streamType}";

            if (!source) return;

            const defaultOptions = {
                controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'pip', 'fullscreen'],
                autoplay: false,
                quality: { default: 720, options: [720, 480, 360] }
            };

            if (type === 'application/x-mpegURL') {
                if (Hls.isSupported()) {
                    const hls = new Hls();
                    hls.loadSource(source);
                    hls.attachMedia(video);
                    hls.on(Hls.Events.MANIFEST_PARSED, function() { new Plyr(video, defaultOptions); });
                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    video.src = source;
                    new Plyr(video, defaultOptions);
                }
            } else {
                video.src = source;
                new Plyr(video, defaultOptions);
            }
        });
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

// B. Route Relay Stream (Bypass Dinamis HLS & Header)
app.get('/relay', async (req, res) => {
    let url = req.query.url;
    let refererHeader = req.query.ref || ""; 
    let originHeader = req.query.ori || "";

    if (!url) return res.status(400).send("URL parameter is missing");

    const isM3U8 = url.includes('.m3u8');
    
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"
    };
    if (refererHeader) headers["Referer"] = refererHeader;
    if (originHeader) headers["Origin"] = originHeader;

    try {
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: isM3U8 ? 'text' : 'stream',
            headers: headers
        });

        if (isM3U8) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
            
            const modifiedM3u8 = response.data.replace(/^(?!#)(.+)$/gm, (match, line) => {
                line = line.trim();
                if (!line) return line; 
                const segmentUrl = line.startsWith('http') ? line : baseUrl + line;
                
                return `/relay?url=${encodeURIComponent(segmentUrl)}&ref=${encodeURIComponent(refererHeader)}&ori=${encodeURIComponent(originHeader)}`;
            });
            
            res.send(modifiedM3u8);
        } else {
            if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
            if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
            
            response.data.pipe(res);
        }
    } catch (error) {
        res.status(500).send("Relay Error: " + error.message);
    }
});

module.exports = app;

if (require.main === module) {
    app.listen(3000, () => {
        console.log('Server is running on port 3000');
    });
}
