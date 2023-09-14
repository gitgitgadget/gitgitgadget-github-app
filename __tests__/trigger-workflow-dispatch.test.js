const mockHTTPSRequest = jest.fn(async (_context, _hostname, method, requestPath) => {
    if (method === 'POST' && requestPath === '/repos/hello/world/actions/workflows/the-workflow.yml/dispatches') {
        return {
            headers: {
                date: '2023-01-23T01:23:45Z'
            }
        }
    }
    if (method === 'GET' && requestPath === '/user') return { login: 'the actor' }
    if (method === 'GET' && requestPath === '/repos/hello/world/actions/runs?actor=the actor&event=workflow_dispatch&created=>2023-01-23T01:23:45.000Z') {
        return {
            workflow_runs: [
                { path: 'not this one.yml' },
                { path: '.github/workflows/the-workflow.yml', breadcrumb: true },
                { path: 'neither this one.yml' }
            ]
        }
    }
    throw new Error(`Unexpected requestPath: ${method} '${requestPath}'`)
})
jest.mock('../GitGitGadget/https-request', () => { return { httpsRequest: mockHTTPSRequest } })

const { triggerWorkflowDispatch } = require('../GitGitGadget/trigger-workflow-dispatch')

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

test('trigger a workflow_dispatch event and wait for workflow run', async () => {
    const context = {}
    const run = await triggerWorkflowDispatch(context, 'my-token', 'hello', 'world', 'the-workflow.yml', 'HEAD', { abc: 123 })
    expect(run).toEqual({
        path: '.github/workflows/the-workflow.yml',
        breadcrumb: true
    })
})