const index = require('../GitGitGadget/index')

process.env['GITHUB_WEBHOOK_SECRET'] = 'for-testing'

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
