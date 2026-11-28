const https = require('https')

const getRef = async (url, ref) => {
    const { hostname, pathname } = new URL(url)
    const requestPath = `${pathname.replace(/\/$/, '')}/info/refs?service=git-upload-pack`
    const body = await new Promise((resolve, reject) => {
        const request = https.request({
            hostname,
            method: 'GET',
            path: requestPath,
            headers: {
                'Git-Protocol': 'version=1',
                'User-Agent': 'GitGitGadget/1.0'
            }
        }, response => {
            const chunks = []
            response.on('data', chunk => chunks.push(chunk))
            response.on('error', reject)
            response.on('end', () => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Could not read ${url}: HTTP ${response.statusCode}`))
                    return
                }
                resolve(Buffer.concat(chunks).toString('utf8'))
            })
        })
        request.on('error', reject)
        request.setTimeout(30_000, () => request.destroy(new Error(`Timed out reading ${url}`)))
        request.end()
    })

    let offset = 0
    while (offset + 4 <= body.length) {
        const length = Number.parseInt(body.slice(offset, offset + 4), 16)
        if (length === 0) {
            offset += 4
            continue
        }
        if (!Number.isInteger(length) || length < 4 || offset + length > body.length) break

        const line = body.slice(offset + 4, offset + length).split('\0', 1)[0].trim()
        const match = line.match(/^([0-9a-f]{40,64})\s+(.+)$/)
        if (match && match[2] === ref) return match[1]
        offset += length
    }

    throw new Error(`Could not find ${ref} in ${url}`)
}

const isUpToDate = async config => {
    if (!config.mailrepo.mirrorURL) return true

    const epoch = config.mailrepo.public_inbox_epoch || 1
    const sourceURL = new URL(`${epoch}/`, config.mailrepo.url).href
    const mirrorURL = new URL(config.mailrepo.mirrorURL)
    if (!mirrorURL.pathname.endsWith('.git')) mirrorURL.pathname += '.git'

    const [sourceOID, mirrorOID] = await Promise.all([
        getRef(sourceURL, `refs/heads/${config.mailrepo.branch}`),
        getRef(mirrorURL.href, config.mailrepo.mirrorRef || `refs/heads/lore-${epoch}`)
    ])
    return sourceOID === mirrorOID
}

module.exports = { isUpToDate }
