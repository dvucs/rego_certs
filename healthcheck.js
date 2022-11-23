const http = require('node:http');
const api_root = process.env.API_ROOT || '/v1'
const options = {
    host: 'localhost',
    port: process.env.APP_PUERTO,
    timeout: 666,
    path:`${api_root}/healthcheck_dd5fe42e6f60ac50e4139e75467fbeeecc26381e`,
};

const healthCheck = http.request(options, (res) => {
    console.log(`HEALTHCHECK STATUS: ${res.statusCode}`);
    if (res.statusCode == 200) {
        process.exit(0);
    }
    else {
        process.exit(1);
    }
});

healthCheck.on('error', function (err) {
    console.error('ERROR');
    process.exit(1);
});

healthCheck.end();