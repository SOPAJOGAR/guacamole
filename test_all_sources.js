const axios = require('axios');

async function testAllSources() {
    console.log('🔍 Testando todas as fontes de torrents...\n');
    
    const query = 'matrix';
    console.log(`🎯 Buscando por: "${query}"\n`);
    
    try {
        // Teste da API principal
        console.log('1️⃣ Testando API principal...');
        const startTime = Date.now();
        const response = await axios.get(`http://localhost:3000/api/search?q=${encodeURIComponent(query)}`);
        const endTime = Date.now();
        
        console.log(`✅ Tempo de resposta: ${endTime - startTime}ms`);
        console.log(`📊 Total de resultados: ${response.data.results}`);
        console.log(`🔗 Fontes encontradas: ${[...new Set(response.data.torrents.map(t => t.source))].join(', ')}`);
        
        // Mostrar alguns resultados
        console.log('\n📋 Primeiros 3 resultados:');
        response.data.torrents.slice(0, 3).forEach((torrent, i) => {
            console.log(`  ${i + 1}. ${torrent.title}`);
            console.log(`     Fonte: ${torrent.source} | Qualidade: ${torrent.quality} | Tamanho: ${torrent.size}`);
            console.log(`     Seeders: ${torrent.seeders} | Leechers: ${torrent.leechers}`);
            console.log('');
        });
        
        // Teste individual das fontes
        console.log('2️⃣ Testando fontes individuais...\n');
        
        const sources = [
            { name: 'YTS', url: 'https://yts.mx/api/v2/list_movies.json?query_term=matrix&limit=5' },
            { name: 'EZTV', url: 'https://eztv.re/api/get-torrents?limit=5&query_term=matrix' },
            { name: 'RARBG', url: 'https://torrent-api.vercel.app/api/search?query=matrix&limit=5' },
            { name: 'The Pirate Bay', url: 'https://apibay.org/q.php?q=matrix&cat=0' }
        ];
        
        for (const source of sources) {
            try {
                console.log(`🌐 Testando ${source.name}...`);
                const sourceResponse = await axios.get(source.url, { timeout: 10000 });
                
                if (sourceResponse.data) {
                    let count = 0;
                    if (source.name === 'YTS' && sourceResponse.data.data?.movies) {
                        count = sourceResponse.data.data.movies.length;
                    } else if (source.name === 'EZTV' && sourceResponse.data.torrents) {
                        count = sourceResponse.data.torrents.length;
                    } else if (source.name === 'RARBG' && sourceResponse.data.torrents) {
                        count = sourceResponse.data.torrents.length;
                    } else if (source.name === 'The Pirate Bay' && Array.isArray(sourceResponse.data)) {
                        count = sourceResponse.data.length;
                    }
                    
                    console.log(`✅ ${source.name}: ${count} resultados`);
                } else {
                    console.log(`⚠️ ${source.name}: Sem dados`);
                }
            } catch (error) {
                console.log(`❌ ${source.name}: ${error.message}`);
            }
        }
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro no teste:', error.message);
    }
}

testAllSources(); 