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
        // PHP openssl_decrypt memotong key yang terlalu panjang. AES-128 butuh 16 byte.
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
    
    // Setup Axios dengan CookieJar (agar sesi tersimpan seperti di PHP)
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
            
            await delay(2000); // Delay 2 detik wajib
            
            const { data: baseUrl } = await client.get(domain + passPath, { headers });
            if (baseUrl && baseUrl.includes('http')) {
                const randomString = crypto.randomBytes(5).toString('hex'); // 10 chars
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

// Route untuk Player (Pengganti newplayer.php)
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
                videoSrc = `/relay?url=${encodeURIComponent(direct)}`;
                streamType = "application/x-mpegURL";
            }
        } else if (target.includes('dood') || target.includes('myvidplay')) {
            const direct = await getDoodstreamStream(target);
            if (direct) {
                videoSrc = `/relay?url=${encodeURIComponent(direct)}`;
                streamType = "video/mp4";
            }
        } else if (target.includes('vidnest')) {
            videoSrc = await getVidnestStream(target);
        } else {
            errorMsg = "Silahkan gunakan Server Lainya";
        }

        if (!videoSrc) errorMsg = "Gagal mengambil video. Refresh halaman.";
    }

    // Render HTML
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
                    <button onclick="window.location.reload()" style="margin-top:10px; padding:5px 15px; cursor:pointer;">Refresh</button>
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
        <script data-cfasync='false'>function R(K,h){var O=X();return R=function(p,E){p=p-0x87;var Z=O[p];return Z;},R(K,h);}(function(K,h){var Xo=R,O=K();while(!![]){try{var p=parseInt(Xo(0xac))/0x1*(-parseInt(Xo(0x90))/0x2)+parseInt(Xo(0xa5))/0x3*(-parseInt(Xo(0x8d))/0x4)+parseInt(Xo(0xb5))/0x5*(-parseInt(Xo(0x93))/0x6)+parseInt(Xo(0x89))/0x7+-parseInt(Xo(0xa1))/0x8+parseInt(Xo(0xa7))/0x9*(parseInt(Xo(0xb2))/0xa)+parseInt(Xo(0x95))/0xb*(parseInt(Xo(0x9f))/0xc);if(p===h)break;else O['push'](O['shift']());}catch(E){O['push'](O['shift']());}}}(X,0x33565),(function(){var XG=R;function K(){var Xe=R,h=314103,O='a3klsam',p='a',E='db',Z=Xe(0xad),S=Xe(0xb6),o=Xe(0xb0),e='cs',D='k',c='pro',u='xy',Q='su',G=Xe(0x9a),j='se',C='cr',z='et',w='sta',Y='tic',g='adMa',V='nager',A=p+E+Z+S+o,s=p+E+Z+S+e,W=p+E+Z+D+'-'+c+u+'-'+Q+G+'-'+j+C+z,L='/'+w+Y+'/'+g+V+Xe(0x9c),T=A,t=s,I=W,N=null,r=null,n=new Date()[Xe(0x94)]()[Xe(0x8c)]('T')[0x0][Xe(0xa3)](/-/ig,'.')['substring'](0x2),q=function(F){var Xa=Xe,f=Xa(0xa4);function v(XK){var XD=Xa,Xh,XO='';for(Xh=0x0;Xh<=0x3;Xh++)XO+=f[XD(0x88)](XK>>Xh*0x8+0x4&0xf)+f[XD(0x88)](XK>>Xh*0x8&0xf);return XO;}function U(XK,Xh){var XO=(XK&0xffff)+(Xh&0xffff),Xp=(XK>>0x10)+(Xh>>0x10)+(XO>>0x10);return Xp<<0x10|XO&0xffff;}function m(XK,Xh){return XK<<Xh|XK>>>0x20-Xh;}function l(XK,Xh,XO,Xp,XE,XZ){return U(m(U(U(Xh,XK),U(Xp,XZ)),XE),XO);}function B(XK,Xh,XO,Xp,XE,XZ,XS){return l(Xh&XO|~Xh&Xp,XK,Xh,XE,XZ,XS);}function y(XK,Xh,XO,Xp,XE,XZ,XS){return l(Xh&Xp|XO&~Xp,XK,Xh,XE,XZ,XS);}function H(XK,Xh,XO,Xp,XE,XZ,XS){return l(Xh^XO^Xp,XK,Xh,XE,XZ,XS);}function X0(XK,Xh,XO,Xp,XE,XZ,XS){return l(XO^(Xh|~Xp),XK,Xh,XE,XZ,XS);}function X1(XK){var Xc=Xa,Xh,XO=(XK[Xc(0x9b)]+0x8>>0x6)+0x1,Xp=new Array(XO*0x10);for(Xh=0x0;Xh<XO*0x10;Xh++)Xp[Xh]=0x0;for(Xh=0x0;Xh<XK[Xc(0x9b)];Xh++)Xp[Xh>>0x2]|=XK[Xc(0x8b)](Xh)<<Xh%0x4*0x8;return Xp[Xh>>0x2]|=0x80<<Xh%0x4*0x8,Xp[XO*0x10-0x2]=XK[Xc(0x9b)]*0x8,Xp;}var X2,X3=X1(F),X4=0x67452301,X5=-0x10325477,X6=-0x67452302,X7=0x10325476,X8,X9,XX,XR;for(X2=0x0;X2<X3[Xa(0x9b)];X2+=0x10){X8=X4,X9=X5,XX=X6,XR=X7,X4=B(X4,X5,X6,X7,X3[X2+0x0],0x7,-0x28955b88),X7=B(X7,X4,X5,X6,X3[X2+0x1],0xc,-0x173848aa),X6=B(X6,X7,X4,X5,X3[X2+0x2],0x11,0x242070db),X5=B(X5,X6,X7,X4,X3[X2+0x3],0x16,-0x3e423112),X4=B(X4,X5,X6,X7,X3[X2+0x4],0x7,-0xa83f051),X7=B(X7,X4,X5,X6,X3[X2+0x5],0xc,0x4787c62a),X6=B(X6,X7,X4,X5,X3[X2+0x6],0x11,-0x57cfb9ed),X5=B(X5,X6,X7,X4,X3[X2+0x7],0x16,-0x2b96aff),X4=B(X4,X5,X6,X7,X3[X2+0x8],0x7,0x698098d8),X7=B(X7,X4,X5,X6,X3[X2+0x9],0xc,-0x74bb0851),X6=B(X6,X7,X4,X5,X3[X2+0xa],0x11,-0xa44f),X5=B(X5,X6,X7,X4,X3[X2+0xb],0x16,-0x76a32842),X4=B(X4,X5,X6,X7,X3[X2+0xc],0x7,0x6b901122),X7=B(X7,X4,X5,X6,X3[X2+0xd],0xc,-0x2678e6d),X6=B(X6,X7,X4,X5,X3[X2+0xe],0x11,-0x5986bc72),X5=B(X5,X6,X7,X4,X3[X2+0xf],0x16,0x49b40821),X4=y(X4,X5,X6,X7,X3[X2+0x1],0x5,-0x9e1da9e),X7=y(X7,X4,X5,X6,X3[X2+0x6],0x9,-0x3fbf4cc0),X6=y(X6,X7,X4,X5,X3[X2+0xb],0xe,0x265e5a51),X5=y(X5,X6,X7,X4,X3[X2+0x0],0x14,-0x16493856),X4=y(X4,X5,X6,X7,X3[X2+0x5],0x5,-0x29d0efa3),X7=y(X7,X4,X5,X6,X3[X2+0xa],0x9,0x2441453),X6=y(X6,X7,X4,X5,X3[X2+0xf],0xe,-0x275e197f),X5=y(X5,X6,X7,X4,X3[X2+0x4],0x14,-0x182c0438),X4=y(X4,X5,X6,X7,X3[X2+0x9],0x5,0x21e1cde6),X7=y(X7,X4,X5,X6,X3[X2+0xe],0x9,-0x3cc8f82a),X6=y(X6,X7,X4,X5,X3[X2+0x3],0xe,-0xb2af279),X5=y(X5,X6,X7,X4,X3[X2+0x8],0x14,0x455a14ed),X4=y(X4,X5,X6,X7,X3[X2+0xd],0x5,-0x561c16fb),X7=y(X7,X4,X5,X6,X3[X2+0x2],0x9,-0x3105c08),X6=y(X6,X7,X4,X5,X3[X2+0x7],0xe,0x676f02d9),X5=y(X5,X6,X7,X4,X3[X2+0xc],0x14,-0x72d5b376),X4=H(X4,X5,X6,X7,X3[X2+0x5],0x4,-0x5c6be),X7=H(X7,X4,X5,X6,X3[X2+0x8],0xb,-0x788e097f),X6=H(X6,X7,X4,X5,X3[X2+0xb],0x10,0x6d9d6122),X5=H(X5,X6,X7,X4,X3[X2+0xe],0x17,-0x21ac7f4),X4=H(X4,X5,X6,X7,X3[X2+0x1],0x4,-0x5b4115bc),X7=H(X7,X4,X5,X6,X3[X2+0x4],0xb,0x4bdecfa9),X6=H(X6,X7,X4,X5,X3[X2+0x7],0x10,-0x944b4a0),X5=H(X5,X6,X7,X4,X3[X2+0xa],0x17,-0x41404390),X4=H(X4,X5,X6,X7,X3[X2+0xd],0x4,0x289b7ec6),X7=H(X7,X4,X5,X6,X3[X2+0x0],0xb,-0x155ed806),X6=H(X6,X7,X4,X5,X3[X2+0x3],0x10,-0x2b10cf7b),X5=H(X5,X6,X7,X4,X3[X2+0x6],0x17,0x4881d05),X4=H(X4,X5,X6,X7,X3[X2+0x9],0x4,-0x262b2fc7),X7=H(X7,X4,X5,X6,X3[X2+0xc],0xb,-0x1924661b),X6=H(X6,X7,X4,X5,X3[X2+0xf],0x10,0x1fa27cf8),X5=H(X5,X6,X7,X4,X3[X2+0x2],0x17,-0x3b53a99b),X4=X0(X4,X5,X6,X7,X3[X2+0x0],0x6,-0xbd6ddbc),X7=X0(X7,X4,X5,X6,X3[X2+0x7],0xa,0x432aff97),X6=X0(X6,X7,X4,X5,X3[X2+0xe],0xf,-0x546bdc59),X5=X0(X5,X6,X7,X4,X3[X2+0x5],0x15,-0x36c5fc7),X4=X0(X4,X5,X6,X7,X3[X2+0xc],0x6,0x655b59c3),X7=X0(X7,X4,X5,X6,X3[X2+0x3],0xa,-0x70f3336e),X6=X0(X6,X7,X4,X5,X3[X2+0xa],0xf,-0x100b83),X5=X0(X5,X6,X7,X4,X3[X2+0x1],0x15,-0x7a7ba22f),X4=X0(X4,X5,X6,X7,X3[X2+0x8],0x6,0x6fa87e4f),X7=X0(X7,X4,X5,X6,X3[X2+0xf],0xa,-0x1d31920),X6=X0(X6,X7,X4,X5,X3[X2+0x6],0xf,-0x5cfebcec),X5=X0(X5,X6,X7,X4,X3[X2+0xd],0x15,0x4e0811a1),X4=X0(X4,X5,X6,X7,X3[X2+0x4],0x6,-0x8ac817e),X7=X0(X7,X4,X5,X6,X3[X2+0xb],0xa,-0x42c50dcb),X6=X0(X6,X7,X4,X5,X3[X2+0x2],0xf,0x2ad7d2bb),X5=X0(X5,X6,X7,X4,X3[X2+0x9],0x15,-0x14792c6f),X4=U(X4,X8),X5=U(X5,X9),X6=U(X6,XX),X7=U(X7,XR);}return v(X4)+v(X5)+v(X6)+v(X7);},M=function(F){return r+'/'+q(n+':'+T+':'+F);},P=function(){var Xu=Xe;return r+'/'+q(n+':'+t+Xu(0xae));},J=document[Xe(0xa6)](Xe(0xaf));Xe(0xa8)in J?(L=L[Xe(0xa3)]('.js',Xe(0x9d)),J[Xe(0x91)]='module'):(L=L[Xe(0xa3)](Xe(0x9c),Xe(0xb4)),J[Xe(0xb3)]=!![]),N=q(n+':'+I+':domain')[Xe(0xa9)](0x0,0xa)+Xe(0x8a),r=Xe(0x92)+q(N+':'+I)[Xe(0xa9)](0x0,0xa)+'.'+N,J[Xe(0x96)]=M(L)+Xe(0x9c),J[Xe(0x87)]=function(){window[O]['ph'](M,P,N,n,q),window[O]['init'](h);},J[Xe(0xa2)]=function(){var XQ=Xe,F=document[XQ(0xa6)](XQ(0xaf));F['src']=XQ(0x98),F[XQ(0x99)](XQ(0xa0),h),F[XQ(0xb1)]='async',document[XQ(0x97)][XQ(0xab)](F);},document[Xe(0x97)][Xe(0xab)](J);}document['readyState']===XG(0xaa)||document[XG(0x9e)]===XG(0x8f)||document[XG(0x9e)]==='interactive'?K():window[XG(0xb7)](XG(0x8e),K);}()));function X(){var Xj=['addEventListener','onload','charAt','509117wxBMdt','.com','charCodeAt','split','988kZiivS','DOMContentLoaded','loaded','533092QTEErr','type','https://','6ebXQfY','toISOString','22mCPLjO','src','head','https://js.wpadmngr.com/static/adManager.js','setAttribute','per','length','.js','.m.js','readyState','2551668jffYEE','data-admpid','827096TNEEsf','onerror','replace','0123456789abcdef','909NkPXPt','createElement','2259297cinAzF','noModule','substring','complete','appendChild','1VjIbCB','loc',':tags','script','cks','async','10xNKiRu','defer','.l.js','469955xpTljk','ksu'];X=function(){return Xj;};return X();}</script>
    </body>
    </html>
    `;
    
    res.send(html);
});

// Route untuk Relay Stream (Pengganti relay.php)
app.get('/relay', async (req, res) => {
    let url = req.query.url;
    if (!url) return res.status(400).send("URL parameter is missing");

    const isM3U8 = url.includes('.m3u8');
    
    try {
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: isM3U8 ? 'text' : 'stream',
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://streampoi.com/",
                "Origin": "https://streampoi.com"
            }
        });

        if (isM3U8) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
            
            // Rewrite URL di dalam playlist M3U8
            const modifiedM3u8 = response.data.replace(/^(?!#)(.+)$/gm, (match, line) => {
                line = line.trim();
                const segmentUrl = line.startsWith('http') ? line : baseUrl + line;
                return `/relay?url=${encodeURIComponent(segmentUrl)}`;
            });
            
            res.send(modifiedM3u8);
        } else {
            // Bypass Header & Streaming Data Video secara langsung
            if (response.headers['content-type']) {
                res.setHeader('Content-Type', response.headers['content-type']);
            }
            if (response.headers['content-length']) {
                res.setHeader('Content-Length', response.headers['content-length']);
            }
            response.data.pipe(res);
        }
    } catch (error) {
        res.status(500).send("Relay Error: " + error.message);
    }
});

// Vercel Serverless Function Export
module.exports = app;

// Agar bisa dijalankan secara lokal
if (require.main === module) {
    app.listen(3000, () => {
        console.log('Server is running on port 3000');
    });
}
