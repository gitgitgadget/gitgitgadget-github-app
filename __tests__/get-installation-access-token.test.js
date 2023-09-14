const mockHTTPSRequest = jest.fn(async (context, hostname, method, requestPath, body, headers) => {
    // We're not validating the authorization, just validating that there is one
    expect(headers.Authorization).toMatch(/Bearer [-.0-9A-Za-z_]{40,}/)

    if (requestPath === '/repos/hello/world/installation') return { id: 17 }
    if (requestPath === '/app/installations/17/access_tokens') return { token: 'i-can-haz-access-token' }
    throw new Error(`Unexpected requestPath: '${requestPath}'`)
})
jest.mock('../GitGitGadget/https-request', () => { return { httpsRequest: mockHTTPSRequest } })
const { getInstallationIdForRepo } = require('../GitGitGadget/get-installation-id-for-repo')
const { getInstallationAccessToken } = require('../GitGitGadget/get-installation-access-token')

const { generateKeyPairSync } = require('crypto')

const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
    },
    privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
    }
})
process.env['GITHUB_APP_PRIVATE_KEY'] = privateKey

test('get an installation access token', async () => {
    const context = {}
    const installationID = await getInstallationIdForRepo(context, 'hello', 'world')
    expect(await getInstallationAccessToken(context, installationID)).toEqual('i-can-haz-access-token')
})