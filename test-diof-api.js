const fetch = require('node-fetch');

async function testAPI() {
  const apiUrl = 'https://diof.io.org.br/api/diario-oficial/edicoes-anteriores-group';
  const body = {
    cod_cliente: '10986',
    dat_envio_ini: '2025-09-26',
    dat_envio_fim: '2025-09-30',
    des_observacao: '',
    edicao: null,
  };
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  console.log('Status:', response.status);
  const data = await response.json();
  console.log('Response:', JSON.stringify(data, null, 2));
}

testAPI();
