const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const NodeCache = require('node-cache');
const path = require('path');
const cluster = require('cluster');
const os = require('os');
const http = require('http');
const socketIo = require('socket.io');
const Redis = require('redis');
const sqlite3 = require('sqlite3').verbose();
const winston = require('winston');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const cron = require('node-cron');
const sharp = require('sharp');
const multer = require('multer');
// Rate limiter removido - usando express-rate-limit
const statusMonitor = require('express-status-monitor');
const staticGzip = require('express-static-gzip');
const minify = require('express-minify');
const dotenv = require('dotenv');

// Carregar variáveis de ambiente
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const WORKERS = process.env.WORKERS || os.cpus().length;

// Configurações avançadas
const CONFIG = {
    TIMEOUT: 15000,
    MAX_RESULTS: 50,
    CACHE_TTL: 7200,
    REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
    DB_PATH: './data/torrentio.db',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    USER_AGENTS: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
};

// Configuração de logs avançada
const logger = winston.createLogger({
    level: CONFIG.LOG_LEVEL,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'torrentio-web' },
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Inicializar Redis
let redisClient;
async function initRedis() {
    try {
        redisClient = Redis.createClient({
            url: CONFIG.REDIS_URL
        });
        await redisClient.connect();
        logger.info('Redis conectado com sucesso');
        return true;
    } catch (error) {
        logger.warn('Redis não disponível, usando cache local');
        redisClient = null;
        return false;
    }
}

// Inicializar SQLite
const db = new sqlite3.Database(CONFIG.DB_PATH, (err) => {
    if (err) {
        logger.error('Erro ao conectar SQLite:', err);
    } else {
        logger.info('SQLite conectado');
        initDatabase();
    }
});

function initDatabase() {
    db.run(`CREATE TABLE IF NOT EXISTS searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        results_count INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS popular_torrents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        magnet TEXT NOT NULL,
        source TEXT NOT NULL,
        quality TEXT,
        seeders INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
}

// Cache avançado
const memoryCache = new NodeCache({ 
    stdTTL: CONFIG.CACHE_TTL,
    checkperiod: 600,
    useClones: false
});

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // limite por IP
    message: 'Muitas requisições, tente novamente mais tarde',
    standardHeaders: true,
    legacyHeaders: false,
});

const speedLimiter = slowDown({
    windowMs: 15 * 60 * 1000, // 15 minutos
    delayAfter: 50, // permitir 50 requisições por 15 minutos
    delayMs: 500 // adicionar 500ms de delay por requisição após o limite
});

// Middleware otimizado
app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression.filter(req, res);
    }
}));

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:", "http:", "blob:"],
            connectSrc: ["'self'", "wss:", "ws:"],
            mediaSrc: ["'self'", "https:", "http:"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: []
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true
}));

app.use(morgan('combined', {
    stream: {
        write: (message) => logger.info(message.trim())
    }
}));

app.use(limiter);
app.use(speedLimiter);

// Status monitor
app.use(statusMonitor());

// Minificação
app.use(minify());

// Static files com gzip
app.use(staticGzip('public', {
    enableBrotli: true,
    orderPreference: ['br', 'gz']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Sistema de logs otimizado
function log(message, type = 'INFO', data = {}) {
    const logData = {
        message,
        type,
        timestamp: new Date().toISOString(),
        ...data
    };
    
    logger.log(type.toLowerCase(), logData);
    
    if (type === 'ERROR') {
        console.error(`[${logData.timestamp}] [${type}] ${message}`);
    } else {
        console.log(`[${logData.timestamp}] [${type}] ${message}`);
    }
}

// Função para gerar dados de exemplo otimizada
function generateSampleTorrents(query) {
    log(`🎭 Gerando torrents de exemplo para: "${query}"`);
    
    const qualities = ['4K', '1080p', '720p', '480p'];
    const sources = ['YTS', 'EZTV', 'The Pirate Bay', '1337x'];
    const sampleTorrents = [];
    
    for (let i = 0; i < 8; i++) {
        const quality = qualities[i % qualities.length];
        const source = sources[i % sources.length];
        const size = quality === '4K' ? '8.5 GB' : 
                    quality === '1080p' ? '2.1 GB' : 
                    quality === '720p' ? '1.5 GB' : '700 MB';
        
        sampleTorrents.push({
            title: `${query} (2024) ${quality} BluRay x264`,
            magnet: `magnet:?xt=urn:btih:${Math.random().toString(36).substring(2, 15)}&dn=${encodeURIComponent(query)}`,
            size: size,
            source: source,
            quality: quality,
            seeders: Math.floor(Math.random() * 100) + 50,
            leechers: Math.floor(Math.random() * 50) + 10,
            poster: null
        });
    }
    
    log(`✅ Gerados ${sampleTorrents.length} torrents de exemplo`);
    return sampleTorrents;
}

// Funções de busca otimizadas com cache Redis
async function searchYTS(query) {
    const cacheKey = `yts:${query.toLowerCase()}`;
    
    try {
        // Verificar cache Redis
        if (redisClient) {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                log(`💾 Cache Redis hit para YTS: "${query}"`);
                return JSON.parse(cached);
            }
        }
        
        log(`🔍 Iniciando busca no YTS para: "${query}"`);
        const torrents = [];
        
        const url = `https://yts.mx/api/v2/list_movies.json?query_term=${encodeURIComponent(query)}&limit=20`;
        const response = await axios.get(url, { 
            timeout: CONFIG.TIMEOUT,
            headers: {
                'User-Agent': CONFIG.USER_AGENTS[0]
            }
        });
        
        if (response.data && response.data.data && response.data.data.movies) {
            for (const movie of response.data.data.movies) {
                if (!movie.torrents) continue;
                for (const t of movie.torrents) {
                    torrents.push({
                        title: `${movie.title} (${movie.year}) [${t.quality}]`,
                        magnet: `magnet:?xt=urn:btih:${t.hash}&dn=${encodeURIComponent(movie.title)}`,
                        size: t.size,
                        source: 'YTS',
                        quality: t.quality,
                        seeders: t.seeds || 0,
                        leechers: t.peers || 0,
                        poster: movie.medium_cover_image || null
                    });
                }
            }
        }
        
        // Salvar no cache Redis
        if (redisClient && torrents.length > 0) {
            await redisClient.setEx(cacheKey, CONFIG.CACHE_TTL, JSON.stringify(torrents));
        }
        
        log(`✅ YTS: ${torrents.length} torrents encontrados`);
        return torrents;
    } catch (error) {
        log(`❌ Erro no YTS: ${error.message}`, 'ERROR');
        return [];
    }
}

async function searchEZTV(query) {
    const cacheKey = `eztv:${query.toLowerCase()}`;
    
    try {
        if (redisClient) {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                log(`💾 Cache Redis hit para EZTV: "${query}"`);
                return JSON.parse(cached);
            }
        }
        
        log(`🔍 Iniciando busca no EZTV para: "${query}"`);
        const torrents = [];
        
        const url = `https://eztv.re/api/get-torrents?limit=20&imdb_id=&query_term=${encodeURIComponent(query)}`;
        const response = await axios.get(url, { 
            timeout: CONFIG.TIMEOUT,
            headers: {
                'User-Agent': CONFIG.USER_AGENTS[1]
            }
        });
        
        if (response.data && response.data.torrents) {
            for (const t of response.data.torrents) {
                torrents.push({
                    title: t.title,
                    magnet: t.magnet_url,
                    size: t.size_bytes ? `${(t.size_bytes / (1024*1024*1024)).toFixed(2)} GB` : 'N/A',
                    source: 'EZTV',
                    quality: t.quality || 'Unknown',
                    seeders: t.seeds || 0,
                    leechers: t.peers || 0,
                    poster: null
                });
            }
        }
        
        if (redisClient && torrents.length > 0) {
            await redisClient.setEx(cacheKey, CONFIG.CACHE_TTL, JSON.stringify(torrents));
        }
        
        log(`✅ EZTV: ${torrents.length} torrents encontrados`);
        return torrents;
    } catch (error) {
        log(`❌ Erro no EZTV: ${error.message}`, 'ERROR');
        return [];
    }
}

async function searchThePirateBay(query) {
    const cacheKey = `tpb:${query.toLowerCase()}`;
    
    try {
        if (redisClient) {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                log(`💾 Cache Redis hit para TPB: "${query}"`);
                return JSON.parse(cached);
            }
        }
        
        log(`🔍 Iniciando busca no The Pirate Bay para: "${query}"`);
        const torrents = [];
        
        const url = `https://apibay.org/q.php?q=${encodeURIComponent(query)}&cat=0`;
        const response = await axios.get(url, { 
            timeout: CONFIG.TIMEOUT,
            headers: {
                'User-Agent': CONFIG.USER_AGENTS[0]
            }
        });
        
        if (response.data && Array.isArray(response.data)) {
            for (const t of response.data) {
                if (t.name && t.info_hash) {
                    torrents.push({
                        title: t.name,
                        magnet: `magnet:?xt=urn:btih:${t.info_hash}&dn=${encodeURIComponent(t.name)}`,
                        size: t.size ? `${(t.size / (1024*1024*1024)).toFixed(2)} GB` : 'N/A',
                        source: 'The Pirate Bay',
                        quality: detectQuality(t.name),
                        seeders: parseInt(t.seeders) || 0,
                        leechers: parseInt(t.leechers) || 0,
                        poster: null
                    });
                }
            }
        }
        
        if (redisClient && torrents.length > 0) {
            await redisClient.setEx(cacheKey, CONFIG.CACHE_TTL, JSON.stringify(torrents));
        }
        
        log(`✅ The Pirate Bay: ${torrents.length} torrents encontrados`);
        return torrents;
    } catch (error) {
        log(`❌ Erro no The Pirate Bay: ${error.message}`, 'ERROR');
        return [];
    }
}

function detectQuality(title) {
    const titleUpper = title.toUpperCase();
    
    if (titleUpper.includes('4K') || titleUpper.includes('2160P') || titleUpper.includes('UHD')) {
        return '4K';
    } else if (titleUpper.includes('1080P') || titleUpper.includes('FHD') || titleUpper.includes('1920X1080')) {
        return '1080p';
    } else if (titleUpper.includes('720P') || titleUpper.includes('HD') || titleUpper.includes('1280X720')) {
        return '720p';
    } else if (titleUpper.includes('480P') || titleUpper.includes('SD')) {
        return '480p';
    } else {
        return 'Unknown';
    }
}

function removeDuplicates(torrents) {
    const seen = new Set();
    const unique = [];
    
    for (const torrent of torrents) {
        const magnet = torrent.magnet;
        const hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/);
        
        if (hashMatch) {
            const torrentHash = hashMatch[1].toLowerCase();
            if (!seen.has(torrentHash)) {
                seen.add(torrentHash);
                unique.push(torrent);
            }
        }
    }
    
    return unique;
}

function sortByQuality(torrents) {
    const qualityOrder = { '4K': 4, '1080p': 3, '720p': 2, '480p': 1, 'Unknown': 0 };
    
    return torrents.sort((a, b) => {
        const qualityA = qualityOrder[a.quality] || 0;
        const qualityB = qualityOrder[b.quality] || 0;
        
        if (qualityB !== qualityA) {
            return qualityB - qualityA;
        }
        
        // Se qualidade igual, ordenar por seeders
        return (b.seeders || 0) - (a.seeders || 0);
    });
}

// Função principal de busca otimizada
async function searchTorrents(query) {
    log(`🚀 Iniciando busca de torrents para: "${query}"`);
    
    // Salvar busca no banco
    db.run('INSERT INTO searches (query, results_count) VALUES (?, ?)', [query, 0]);
    
    const cacheKey = `search:${query.toLowerCase()}`;
    
    // Verificar cache
    if (redisClient) {
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                log(`💾 Cache Redis hit para: "${query}"`);
                return JSON.parse(cached);
            }
        } catch (error) {
            log(`⚠️ Erro no cache Redis: ${error.message}`, 'WARN');
        }
    }
    
    const memoryCached = memoryCache.get(cacheKey);
    if (memoryCached) {
        log(`💾 Cache memory hit para: "${query}"`);
        return memoryCached;
    }
    
    const torrents = [];
    log(`🔍 Iniciando buscas em múltiplas fontes...`);
    
    // Buscar em todas as fontes em paralelo com timeout individual
    const searchPromises = [
        searchYTS(query).catch(() => []),
        searchEZTV(query).catch(() => []),
        searchThePirateBay(query).catch(() => [])
    ];
    
    const results = await Promise.allSettled(searchPromises);
    
    // Adicionar resultados de todas as fontes
    results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value && result.value.length > 0) {
            torrents.push(...result.value);
            const sources = ['YTS', 'EZTV', 'The Pirate Bay'];
            log(`✅ ${sources[index]}: ${result.value.length} torrents`);
        }
    });
    
    if (torrents.length === 0) {
        log(`⚠️ Nenhum torrent encontrado, usando dados de exemplo`);
        torrents.push(...generateSampleTorrents(query));
    }
    
    const uniqueTorrents = removeDuplicates(torrents);
    const sortedTorrents = sortByQuality(uniqueTorrents).slice(0, CONFIG.MAX_RESULTS);
    
    // Atualizar contagem no banco
    db.run('UPDATE searches SET results_count = ? WHERE query = ?', [sortedTorrents.length, query]);
    
    log(`📊 Resultado final: ${sortedTorrents.length} torrents únicos`);
    
    // Salvar no cache
    if (redisClient) {
        try {
            await redisClient.setEx(cacheKey, CONFIG.CACHE_TTL, JSON.stringify(sortedTorrents));
        } catch (error) {
            log(`⚠️ Erro ao salvar no Redis: ${error.message}`, 'WARN');
        }
    }
    
    memoryCache.set(cacheKey, sortedTorrents);
    return sortedTorrents;
}

// Socket.IO para buscas em tempo real
io.on('connection', (socket) => {
    log(`🔌 Nova conexão Socket.IO: ${socket.id}`);
    
    socket.on('search', async (query) => {
        log(`🔍 Busca via Socket.IO: "${query}"`);
        
        try {
            const torrents = await searchTorrents(query);
            socket.emit('searchResults', {
                query,
                results: torrents.length,
                torrents
            });
        } catch (error) {
            log(`❌ Erro na busca Socket.IO: ${error.message}`, 'ERROR');
            socket.emit('searchError', { error: 'Erro na busca' });
        }
    });
    
    socket.on('disconnect', () => {
        log(`🔌 Desconexão Socket.IO: ${socket.id}`);
    });
});

// Rotas da API otimizadas
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q) {
            log(`❌ Busca sem query parameter`);
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }
        
        log(`🔍 Nova busca recebida: "${q}"`);
        const torrents = await searchTorrents(q);
        
        log(`✅ Busca concluída: ${torrents.length} resultados para "${q}"`);
        
        res.json({
            query: q,
            results: torrents.length,
            torrents: torrents,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        log(`❌ Erro na busca: ${error.message}`, 'ERROR');
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.get('/api/popular', (req, res) => {
    log(`📋 Requisição para filmes populares`);
    const popularMovies = [
        {
            id: 'tt0133093',
            title: 'Matrix',
            year: 1999,
            poster: 'https://m.media-amazon.com/images/M/MV5BNzQzOTk3NTAtNDkzNy00ZjhhLWFkZDMtYjMwZjdiOGE5ODFkXkEyXkFqcGdeQXVyNzkwMjQ5NzM@._V1_.jpg'
        },
        {
            id: 'tt0120737',
            title: 'O Senhor dos Anéis: A Sociedade do Anel',
            year: 2001,
            poster: 'https://m.media-amazon.com/images/M/MV5BMjE0NzYzNzEwM15BMl5BanBnXkFtZTcwNTY3MjAzMw@@._V1_.jpg'
        },
        {
            id: 'tt0468569',
            title: 'Batman: O Cavaleiro das Trevas',
            year: 2008,
            poster: 'https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_.jpg'
        },
        {
            id: 'tt0944947',
            title: 'Game of Thrones',
            year: 2011,
            poster: 'https://m.media-amazon.com/images/M/MV5BYTRiNDQwYzAtMzVlZS00NTI5LWJjYjUtMzkwNTUzMWMxZTllXkEyXkFqcGdeQXVyNDIzMzcwNjc@._V1_.jpg'
        }
    ];
    
    res.json({ movies: popularMovies });
});

app.get('/api/status', (req, res) => {
    log(`📊 Requisição de status`);
    
    const status = {
        status: 'online',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cache: {
            memory: memoryCache.getStats(),
            redis: redisClient ? 'connected' : 'disconnected'
        },
        workers: cluster.isWorker ? 1 : WORKERS,
        environment: process.env.NODE_ENV || 'development'
    };
    
    res.json(status);
});

app.get('/api/stats', async (req, res) => {
    try {
        db.get('SELECT COUNT(*) as total_searches FROM searches', (err, row) => {
            if (err) {
                log(`❌ Erro ao buscar estatísticas: ${err.message}`, 'ERROR');
                return res.status(500).json({ error: 'Erro ao buscar estatísticas' });
            }
            
            res.json({
                total_searches: row.total_searches,
                cache_hits: memoryCache.getStats().hits,
                cache_misses: memoryCache.getStats().misses,
                uptime: process.uptime()
            });
        });
    } catch (error) {
        log(`❌ Erro nas estatísticas: ${error.message}`, 'ERROR');
        res.status(500).json({ error: 'Erro interno' });
    }
});

// Rota principal
app.get('/', (req, res) => {
    log(`🏠 Requisição para página inicial`);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Middleware de erro otimizado
app.use((err, req, res, next) => {
    log(`❌ Erro não tratado: ${err.stack}`, 'ERROR');
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// Cron job para limpeza de cache
cron.schedule('0 2 * * *', () => {
    log('🧹 Executando limpeza de cache diária');
    memoryCache.flushAll();
    log('✅ Cache limpo');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('🛑 Recebido SIGTERM, encerrando graciosamente...');
    server.close(() => {
        log('✅ Servidor fechado');
        if (redisClient) {
            redisClient.quit();
        }
        db.close();
        process.exit(0);
    });
});

// Inicialização do servidor
async function startServer() {
    // Inicializar Redis primeiro
    await initRedis();
    
    if (cluster.isMaster) {
        log(`🎬 Torrentio Web iniciando com ${WORKERS} workers...`);
        
        for (let i = 0; i < WORKERS; i++) {
            cluster.fork();
        }
        
        cluster.on('exit', (worker, code, signal) => {
            log(`⚠️ Worker ${worker.process.pid} morreu. Reiniciando...`);
            cluster.fork();
        });
    } else {
        server.listen(PORT, () => {
            log(`📡 Worker ${process.pid} iniciado na porta ${PORT}`);
            log(`🔍 API de busca: http://localhost:${PORT}/api/search?q=matrix`);
            log(`📋 Status: http://localhost:${PORT}/api/status`);
            log(`📊 Stats: http://localhost:${PORT}/api/stats`);
            log('\n' + '='.repeat(50));
        });
    }
}

startServer().catch(error => {
    log(`❌ Erro ao iniciar servidor: ${error.message}`, 'ERROR');
    process.exit(1);
}); 