const https = require('https')

const parseRefAdvertisement = (body, ref, url) => {
    let offset = 0
    while (offset + 4 <= body.length) {
        const packetHeader = body.slice(offset, offset + 4)
        if (!/^[0-9a-f]{4}$/i.test(packetHeader)) break

        const length = Number.parseInt(packetHeader, 16)
        if (length === 0 || length === 1 || length === 2) {
            offset += 4
            continue
        }
        if (length < 4 || offset + length > body.length) break

        const line = body.slice(offset + 4, offset + length).split('\0', 1)[0].trim()
        const match = line.match(/^([0-9a-f]{40,64})\s+(.+)$/)
        if (match && match[2] === ref) return match[1]
        offset += length
    }

    throw new Error(`Could not find ${ref} in ${url}`)
}

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

    return parseRefAdvertisement(body, ref, url)
}

const isUpToDate = async config => {
    if (!config.mailrepo.mirrorURL) return true

    const epoch = config.mailrepo.public_inbox_epoch || 1
    const sourceURL = new URL(config.mailrepo.url)
    sourceURL.pathname = `${sourceURL.pathname.replace(/\/+$/, '')}/${epoch}/`
    sourceURL.search = ''
    sourceURL.hash = ''
    const mirrorURL = new URL(config.mailrepo.mirrorURL)
    if (sourceURL.protocol !== 'https:' || mirrorURL.protocol !== 'https:') {
        throw new Error('Mailing-list source and mirror URLs must use HTTPS')
    }
    mirrorURL.pathname = mirrorURL.pathname.replace(/\/+$/, '')
    if (!mirrorURL.pathname.endsWith('.git')) mirrorURL.pathname += '.git'

    const [sourceOID, mirrorOID] = await Promise.all([
        getRef(sourceURL.href, `refs/heads/${config.mailrepo.branch}`),
        getRef(mirrorURL.href, config.mailrepo.mirrorRef || `refs/heads/lore-${epoch}`)
    ])
    return sourceOID === mirrorOID
}

module.exports = { isUpToDate, parseRefAdvertisement }
