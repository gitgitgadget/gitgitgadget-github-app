const mockTriggerWorkflowDispatch = jest.fn(async (_context, _token, _owner, _repo, workflow_id, ref, inputs) => {
    return { html_url: `<the URL to the workflow ${workflow_id} run on ${ref} with inputs ${JSON.stringify(inputs)}>` }
})
jest.mock('../GitGitGadget/trigger-workflow-dispatch', () => ({
    triggerWorkflowDispatch: mockTriggerWorkflowDispatch,
    listWorkflowRuns: jest.fn(async (_context, _token, _owner, _repo, workflow_id, branch, status) => {
        if (workflow_id === 'update-prs.yml' && branch === 'main' && status === 'queued') {
            // pretend that `update-prs` is clogged up, for whatever reason
            return [
                { id: 1, head_branch: 'main', status: 'queued', html_url: '<the URL to the workflow run>' },
                { id: 2, head_branch: 'main', status: 'queued', html_url: '<another URL to the workflow run>' }
            ]
        }
        return []
    })
}))

const index = require('../GitGitGadget/index')
const crypto = require('crypto')
const stream = require('stream')
const https = require('https')

afterEach(() => {
    jest.clearAllMocks();
})

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
        expect(context.done).not.toHaveBeenCalled()
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

const testIssueComment = (comment, repoOwner, fn) => {
    if (!fn) {
        fn = repoOwner
        repoOwner = undefined
    }
    repoOwner ||= 'gitgitgadget'
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
            expect(context.done).not.toHaveBeenCalled()
        } catch (e) {
            context.log.mock.calls.forEach(e => console.log(e[0]))
            throw e;
        }
    })
}

testIssueComment('/test', async (context) => {
    expect(context.done).not.toHaveBeenCalled()
    expect(context.res).toEqual({
        body: 'Okay, triggered <the URL to the workflow handle-pr-comment.yml run on main with inputs {"pr-comment-url":"https://github.com/gitgitgadget/git/pull/1886743660"}>!'
    })
    expect(mockRequest.write).not.toHaveBeenCalled()
    expect(mockRequest.end).not.toHaveBeenCalled()
})

testIssueComment('/verify-repository', 'nope', (context) => {
    expect(context.done).not.toHaveBeenCalled()
    expect(context.res).toEqual({
        body: 'Refusing to work on any repository outside of gitgitgadget, git, dscho',
        'status': 403,
    })
    expect(mockRequest.write).not.toHaveBeenCalled()
    expect(mockRequest.end).not.toHaveBeenCalled()
})

const testWebhookPayload = (testLabel, gitHubEvent, payload, fn) => {
    const context = makeContext(payload, {
        'x-github-event': gitHubEvent
    })

    test(testLabel, async () => {
        try {
            expect(await index(context, context.req)).toBeUndefined()
            await fn(context)
            expect(context.done).not.toHaveBeenCalled()
        } catch (e) {
            context.log.mock.calls.forEach(e => console.log(e[0]))
            throw e;
        }
    })
}

testWebhookPayload('react to `next` being pushed to git/git', 'push', {
    ref: 'refs/heads/next',
    repository: {
        full_name: 'git/git',
        owner: {
            login: 'git'
        }
    }
}, (context) => {
    expect(context.res).toEqual({
        body: 'push(refs/heads/next): triggered <the URL to the workflow sync-ref.yml run on main with inputs {"ref":"refs/heads/next"}>'
    })
    expect(mockTriggerWorkflowDispatch).toHaveBeenCalledTimes(1)
    expect(mockTriggerWorkflowDispatch.mock.calls[0]).toEqual([
        context,
        undefined,
        'gitgitgadget-workflows',
        'gitgitgadget-workflows',
        'sync-ref.yml',
        'main', {
            ref: 'refs/heads/next'
        }
    ])
})

testWebhookPayload('react to `seen` being pushed to git/git', 'push', {
    ref: 'refs/heads/seen',
    repository: {
        full_name: 'git/git',
        owner: {
            login: 'git'
        }
    }
}, (context) => {
    expect(context.res).toEqual({
        body: [
            'push(refs/heads/seen):',
            'triggered <the URL to the workflow sync-ref.yml run on main with inputs {"ref":"refs/heads/seen"}>',
            'and <the URL to the workflow update-mail-to-commit-notes.yml run on main with inputs undefined>'
        ].join(' ')
    })
    // we expect `update-prs` _not_ to be triggered here because we pretend that it is already queued
    expect(mockTriggerWorkflowDispatch).toHaveBeenCalledTimes(2)
    expect(mockTriggerWorkflowDispatch.mock.calls[0]).toEqual([
        context,
        undefined,
        'gitgitgadget-workflows',
        'gitgitgadget-workflows',
        'sync-ref.yml',
        'main', {
            ref: 'refs/heads/seen'
        }
    ])
    expect(mockTriggerWorkflowDispatch.mock.calls[1]).toEqual([
        context,
        undefined,
        'gitgitgadget-workflows',
        'gitgitgadget-workflows',
        'update-mail-to-commit-notes.yml',
        'main',
        undefined
    ])
})

testWebhookPayload('react to `lore-1` being pushed to https://github.com/gitgitgadget/git-mailing-list-mirror', 'push', {
    ref: 'refs/heads/lore-1',
    repository: {
        full_name: 'gitgitgadget/git-mailing-list-mirror',
        owner: {
            login: 'gitgitgadget'
        }
    }
}, (context) => {
    expect(context.res).toEqual({
        body: [
            'push(refs/heads/lore-1 in gitgitgadget/git-mailing-list-mirror):',
            'triggered <the URL to the workflow handle-new-mails.yml run on main with inputs undefined>'
        ].join(' ')
    })
    expect(mockTriggerWorkflowDispatch).toHaveBeenCalledTimes(1)
    expect(mockTriggerWorkflowDispatch.mock.calls[0]).toEqual([
        context,
        undefined,
        'gitgitgadget-workflows',
        'gitgitgadget-workflows',
        'handle-new-mails.yml',
        'main',
        undefined
    ])
})
testWebhookPayload('react to PR push', 'pull_request', {
    action: 'synchronize',
    pull_request: {
        html_url: 'https://github.com/gitgitgadget/git/pull/1956',
    },
    repository: {
        full_name: 'gitgitgadget/git',
        owner: {
            login: 'gitgitgadget'
        }
    }
}, (context) => {
    expect(context.res).toEqual({
        body: [
            'Okay, triggered <the URL to the workflow handle-pr-push.yml run on main with inputs',
            '{"pr-url":"https://github.com/gitgitgadget/git/pull/1956"}>!'
        ].join(' ')
    })
    expect(mockTriggerWorkflowDispatch).toHaveBeenCalledTimes(1)
    expect(mockTriggerWorkflowDispatch.mock.calls[0]).toEqual([
        context,
        undefined,
        'gitgitgadget-workflows',
        'gitgitgadget-workflows',
        'handle-pr-push.yml',
        'main', {
            'pr-url': 'https://github.com/gitgitgadget/git/pull/1956',
        }
    ])
})
