jest.mock('https')
const https = require('https')
const { isUpToDate, parseRefAdvertisement } = require('../GitGitGadget/mailing-list-mirror')
const EventEmitter = require('events')

let responses

https.request = jest.fn((options, callback) => {
    const { body, statusCode = 200 } = responses.shift()
    const request = new EventEmitter()
    request.setTimeout = jest.fn()
    request.end = () => {
        const response = new EventEmitter()
        response.statusCode = statusCode
        callback(response)
        response.emit('data', Buffer.from(body))
        response.emit('end')
    }
    return request
})

const packet = line => `${(Buffer.byteLength(line) + 4).toString(16).padStart(4, '0')}${line}`

const advertisement = (refs, capabilities = 'multi_ack side-band') => [
    packet('# service=git-upload-pack\n'),
    '0000',
    packet('version 1\n'),
    ...refs.map(([oid, ref], index) => packet(`${oid} ${ref}${index === 0 ? `\0${capabilities}` : ''}\n`)),
    '0000'
].join('')

const makeConfig = () => ({
    mailrepo: {
        url: 'https://lore.kernel.org/git',
        branch: 'master',
        public_inbox_epoch: 1,
        mirrorURL: 'https://github.com/gitgitgadget/git-mailing-list-mirror/',
        mirrorRef: 'refs/heads/lore-1'
    }
})

beforeEach(() => {
    jest.clearAllMocks()
    responses = []
})

test('read a ref from a Git protocol v1 advertisement', () => {
    const head = 'a'.repeat(40)
    const master = 'b'.repeat(40)
    const mirror = 'c'.repeat(40)
    const body = advertisement([
        [head, 'HEAD'],
        [master, 'refs/heads/master'],
        [mirror, 'refs/heads/lore-1']
    ])

    expect(parseRefAdvertisement(body, 'refs/heads/lore-1', 'https://example.com/repo.git')).toBe(mirror)
})

test('reject an advertisement without the requested ref', () => {
    const body = advertisement([['a'.repeat(40), 'refs/heads/master']])

    expect(() => parseRefAdvertisement(body, 'refs/heads/lore-1', 'https://example.com/repo.git'))
        .toThrow('Could not find refs/heads/lore-1')
})

test('reject a malformed packet advertisement', () => {
    expect(() => parseRefAdvertisement('zzzz', 'refs/heads/master', 'https://example.com/repo.git'))
        .toThrow('Could not find refs/heads/master')
})

test('compare the lore and mirror refs when URLs lack or have trailing slashes', async () => {
    const source = 'a'.repeat(40)
    responses = [
        { body: advertisement([[source, 'refs/heads/master']]) },
        { body: advertisement([[source, 'refs/heads/lore-1']]) }
    ]

    await expect(isUpToDate(makeConfig())).resolves.toBe(true)

    expect(https.request.mock.calls.map(([options]) => [options.hostname, options.path])).toEqual([
        ['lore.kernel.org', '/git/1/info/refs?service=git-upload-pack'],
        ['github.com', '/gitgitgadget/git-mailing-list-mirror.git/info/refs?service=git-upload-pack']
    ])
    for (const [options] of https.request.mock.calls) {
        expect(options.headers['Git-Protocol']).toBe('version=1')
        expect(options.headers['User-Agent']).toBe('GitGitGadget/1.0')
    }
})

test('report when the GitHub mirror is behind lore', async () => {
    responses = [
        { body: advertisement([['a'.repeat(40), 'refs/heads/master']]) },
        { body: advertisement([['b'.repeat(40), 'refs/heads/lore-1']]) }
    ]

    await expect(isUpToDate(makeConfig())).resolves.toBe(false)
})

test('fail when either ref advertisement cannot be fetched', async () => {
    responses = [
        { body: 'Forbidden', statusCode: 403 },
        { body: advertisement([['a'.repeat(40), 'refs/heads/lore-1']]) }
    ]

    await expect(isUpToDate(makeConfig())).rejects.toThrow('HTTP 403')
})

test('reject non-HTTPS source and mirror URLs', async () => {
    const config = makeConfig()
    config.mailrepo.mirrorURL = 'http://github.com/gitgitgadget/git-mailing-list-mirror'

    await expect(isUpToDate(config)).rejects.toThrow('must use HTTPS')

    expect(https.request).not.toHaveBeenCalled()
})

test('skip ref polling when no GitHub mirror is configured', async () => {
    const config = makeConfig()
    delete config.mailrepo.mirrorURL

    await expect(isUpToDate(config)).resolves.toBe(true)

    expect(https.request).not.toHaveBeenCalled()
})
