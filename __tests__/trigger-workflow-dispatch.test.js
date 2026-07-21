const mockHTTPSRequest = jest.fn(async (_context, _hostname, method, requestPath) => {
    if (method === 'POST' && requestPath === '/repos/hello/world/actions/workflows/run-details.yml/dispatches') {
        return {
            workflow_run_id: 12345,
            run_url: 'https://api.github.com/repos/hello/world/actions/runs/12345',
            html_url: 'https://github.com/hello/world/actions/runs/12345'
        }
    }
    if (method === 'POST' && requestPath === '/repos/hello/world/actions/workflows/the-workflow.yml/dispatches') {
        return {
            headers: {
                date: '2023-01-23T01:23:45Z'
            }
        }
    }
    if (method === 'GET' && requestPath === '/user') return { login: 'the actor' }
    if (method === 'GET' && requestPath === '/repos/hello/world/actions/runs?actor=the actor&event=workflow_dispatch&created=2023-01-23T01:23:40.000Z..*') {
        return {
            workflow_runs: [
                { path: 'not this one.yml' },
                { path: '.github/workflows/the-workflow.yml', breadcrumb: true },
                { path: 'neither this one.yml' }
            ]
        }
    }
    if (method === 'GET' && requestPath === '/repos/hello/world/actions/workflows/the-workflow.yml/runs?branch=main&status=queued') {
        return {
            workflow_runs: [
                { id: 1, head_branch: 'main', status: 'queued' },
                { id: 2, head_branch: 'main', status: 'queued' },
            ]
        }
    }
    throw new Error(`Unexpected requestPath: ${method} '${requestPath}'`)
})
jest.mock('../GitGitGadget/https-request', () => { return { httpsRequest: mockHTTPSRequest } })

const { triggerWorkflowDispatch, listWorkflowRuns } = require('../GitGitGadget/trigger-workflow-dispatch')

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

beforeEach(() => mockHTTPSRequest.mockClear())

test('use workflow run details returned by the dispatch', async () => {
    const context = {}
    const run = await triggerWorkflowDispatch(context, 'my-token', 'hello', 'world', 'run-details.yml', 'HEAD', { abc: 123 })
    expect(run).toEqual({
        workflow_run_id: 12345,
        run_url: 'https://api.github.com/repos/hello/world/actions/runs/12345',
        html_url: 'https://github.com/hello/world/actions/runs/12345'
    })
    expect(mockHTTPSRequest).toHaveBeenCalledTimes(1)
    expect(mockHTTPSRequest.mock.calls[0][4]).toEqual({
        ref: 'HEAD',
        inputs: { abc: 123 },
        return_run_details: true
    })
})

test('fall back to waiting for the workflow run', async () => {
    const context = {}
    const run = await triggerWorkflowDispatch(context, 'my-token', 'hello', 'world', 'the-workflow.yml', 'HEAD', { abc: 123 })
    expect(run).toEqual({
        path: '.github/workflows/the-workflow.yml',
        breadcrumb: true
    })
    expect(mockHTTPSRequest.mock.calls[0][4]).toEqual({
        ref: 'HEAD',
        inputs: { abc: 123 },
        return_run_details: true
    })
})

test('list workflow runs', async () => {
    const context = {}
    const runs = await listWorkflowRuns(context, 'my-token', 'hello', 'world', 'the-workflow.yml', 'main', 'queued')
    expect(runs.length).toEqual(2)
})