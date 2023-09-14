const https = require('https');

const triggerAzurePipeline = async (token, organization, project, buildDefinitionId, sourceBranch, parameters) => {
    const auth = Buffer.from('PAT:' + token).toString('base64');
    const headers = {
        'Accept': 'application/json; api-version=5.0-preview.5; excludeUrls=true',
        'Authorization': 'Basic ' + auth,
    };
    const json = JSON.stringify({
        'definition': { 'id': buildDefinitionId },
        'sourceBranch': sourceBranch,
        'parameters': JSON.stringify(parameters),
    });
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(json);

    const requestOptions = {
        host: 'dev.azure.com',
        port: '443',
        path: `/${organization}/${project}/_apis/build/builds?ignoreWarnings=false&api-version=5.0-preview.5`,
        method: 'POST',
        headers: headers
    };

    return new Promise((resolve, reject) => {
        const handleResponse = (res) => {
            res.setEncoding('utf8');
            var response = '';
            res.on('data', (chunk) => {
                response += chunk;
            });
            res.on('end', () => {
                resolve(JSON.parse(response));
            });
            res.on('error', (err) => {
                reject(err);
            })
        };

        const request = https.request(requestOptions, handleResponse);
        request.write(json);
        request.end();
    });
}

module.exports = {
    triggerAzurePipeline
}