const index = require('../GitGitGadget/index')
const crypto = require('crypto')
const stream = require('stream')
const https = require('https')

process.env['GITHUB_WEBHOOK_SECRET'] = 'for-testing'
process.env['GITGITGADGET_TRIGGER_TOKEN'] = 'token-for-testing'

test('reject requests other than webhook payloads', async () => {
    const context = {
        log: jest.fn(),
        req: {
            method: 'GET',
            headers: {
                'content-type': 'text/plain'
            }
        },
        done: jest.fn()
    }

    const expectInvalidWebhook = async (message) => {
        context.log.mockClear()
        context.done.mockClear()
        expect(await index(context, context.req)).toBeUndefined()
        expect(context.log).toHaveBeenCalledTimes(1)
        expect(context.log.mock.calls[0][0]).toEqual(`Caught Error: ${message}`)
        expect(context.res).toEqual({
            body: `Not a valid GitHub webhook: Error: ${message}`,
            status: 403
        })
        expect(context.done).toHaveBeenCalledTimes(1)
    }

    await expectInvalidWebhook('Unexpected content type: text/plain')

    context.req.method = 'POST'
    context.req.headers = {
        'content-type': 'text/plain'
    }
    await expectInvalidWebhook('Unexpected content type: text/plain')

    context.req.headers['content-type'] = 'application/json'
    await expectInvalidWebhook('Missing X-Hub-Signature')

    context.req.headers['x-hub-signature-256'] = 'invalid'
    await expectInvalidWebhook('Unexpected X-Hub-Signature format: invalid')

    context.req.headers['x-hub-signature-256'] = 'sha256=incorrect'
    context.req.rawBody = '# empty'
    await expectInvalidWebhook('Incorrect X-Hub-Signature')
})

jest.mock('https')

const mockRequest = {
    write: jest.fn(),
    end: jest.fn()
}
https.request = jest.fn().mockImplementation((options, cb) => {
    const s = new stream()
    s.setEncoding = jest.fn()
    cb(s)
    s.emit('data', '{}')
    s.emit('end')
    return mockRequest
})

const makeContext = (body, headers) => {
    const rawBody = JSON.stringify(body)
    const sha256 = crypto.createHmac('sha256', process.env['GITHUB_WEBHOOK_SECRET']).update(rawBody).digest('hex')
    return {
        log: jest.fn(),
        req: {
            body,
            headers: {
                'content-type': 'application/json',
                'x-hub-signature-256': `sha256=${sha256}`,
                ...headers || {}
            },
            method: 'POST',
            rawBody
        },
        done: jest.fn()
    }
}

const testIssueComment = (comment, fn) => {
    const repoOwner = 'gitgitgadget'
    const number = 0x70756c6c
    const context = makeContext({
        action: 'created',
        comment: {
            body: comment,
            html_url: `https://github.com/${repoOwner}/git/pull/${number}`,
            id: 0x636f6d6d656e74,
            user: {
                login: 'alice wonderland'
            }
        },
        installation: {
            id: 123
        },
        issue: {
            number
        },
        repository: {
            name: 'git',
            owner: {
                login: repoOwner
            }
        }
    }, {
        'x-github-event': 'issue_comment'
    })

    test(`test ${comment}`, async () => {
        try {
            expect(await index(context, context.req)).toBeUndefined()
            await fn(context)
            expect(context.done).toHaveBeenCalledTimes(1)
        } catch (e) {
            context.log.mock.calls.forEach(e => console.log(e[0]))
            throw e;
        }
    })
}

testIssueComment('/test', async (context) => {
    expect(context.done).toHaveBeenCalledTimes(1)
    expect(context.res).toEqual({
        body: 'Okay!'
    })
    expect(mockRequest.write).toHaveBeenCalledTimes(1)
    expect(JSON.parse(mockRequest.write.mock.calls[0][0])).toEqual({
        definition: {
            id: 3
        },
        sourceBranch: 'refs/pull/1886743660/head',
        parameters: '{"pr.comment.id":27988538471837300}'
    })
    expect(mockRequest.end).toHaveBeenCalledTimes(1)
})
