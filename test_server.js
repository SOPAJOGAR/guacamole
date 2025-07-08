const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testAPI() {
    console.log('🧪 Iniciando testes da API...\n');
    
    try {
        // Teste 1: Status da API
        console.log('1️⃣ Testando status da API...');
        const statusResponse = await axios.get(`${BASE_URL}/api/status`);
        console.log('✅ Status:', statusResponse.data.status);
        console.log('📊 Versão:', statusResponse.data.version);
        console.log('⏱️ Uptime:', Math.floor(statusResponse.data.uptime), 'segundos\n');
        
        // Teste 2: Busca de torrents
        console.log('2️⃣ Testando busca de torrents...');
        const searchResponse = await axios.get(`${BASE_URL}/api/search?q=matrix`);
        console.log('✅ Busca realizada com sucesso');
        console.log('🔍 Query:', searchResponse.data.query);
        console.log('📊 Resultados:', searchResponse.data.results);
        console.log('📅 Timestamp:', searchResponse.data.timestamp);
        
        if (searchResponse.data.torrents && searchResponse.data.torrents.length > 0) {
            console.log('🎬 Primeiro torrent:');
            const firstTorrent = searchResponse.data.torrents[0];
            console.log('   📝 Título:', firstTorrent.title);
            console.log('   🧲 Magnet:', firstTorrent.magnet.substring(0, 50) + '...');
            console.log('   📦 Tamanho:', firstTorrent.size);
            console.log('   🏷️ Qualidade:', firstTorrent.quality);
            console.log('   🌱 Seeders:', firstTorrent.seeders);
            console.log('   📡 Fonte:', firstTorrent.source);
        }
        console.log('');
        
        // Teste 3: Filmes populares
        console.log('3️⃣ Testando filmes populares...');
        const popularResponse = await axios.get(`${BASE_URL}/api/popular`);
        console.log('✅ Filmes populares carregados');
        console.log('📽️ Quantidade:', popularResponse.data.movies.length);
        
        if (popularResponse.data.movies.length > 0) {
            console.log('🎬 Primeiro filme:');
            const firstMovie = popularResponse.data.movies[0];
            console.log('   📝 Título:', firstMovie.title);
            console.log('   📅 Ano:', firstMovie.year);
            console.log('   🆔 ID:', firstMovie.id);
        }
        console.log('');
        
        // Teste 4: Estatísticas
        console.log('4️⃣ Testando estatísticas...');
        const statsResponse = await axios.get(`${BASE_URL}/api/stats`);
        console.log('✅ Estatísticas carregadas');
        console.log('🔍 Total de buscas:', statsResponse.data.total_searches);
        console.log('💾 Cache hits:', statsResponse.data.cache_hits);
        console.log('❌ Cache misses:', statsResponse.data.cache_misses);
        console.log('⏱️ Uptime:', Math.floor(statsResponse.data.uptime), 'segundos\n');
        
        // Teste 5: Busca com diferentes termos
        console.log('5️⃣ Testando buscas com diferentes termos...');
        const searchTerms = ['batman', 'game of thrones', 'inception'];
        
        for (const term of searchTerms) {
            try {
                const response = await axios.get(`${BASE_URL}/api/search?q=${encodeURIComponent(term)}`);
                console.log(`✅ "${term}": ${response.data.results} resultados`);
            } catch (error) {
                console.log(`❌ "${term}": Erro na busca`);
            }
        }
        console.log('');
        
        // Teste 6: Página inicial
        console.log('6️⃣ Testando página inicial...');
        const homeResponse = await axios.get(`${BASE_URL}/`);
        console.log('✅ Página inicial carregada');
        console.log('📄 Status:', homeResponse.status);
        console.log('📏 Tamanho:', homeResponse.data.length, 'bytes\n');
        
        console.log('🎉 Todos os testes passaram com sucesso!');
        console.log('🚀 Servidor está funcionando perfeitamente.');
        
    } catch (error) {
        console.error('❌ Erro nos testes:', error.message);
        if (error.response) {
            console.error('📊 Status:', error.response.status);
            console.error('📄 Dados:', error.response.data);
        }
    }
}

// Executar testes
testAPI(); 