const { gitHubAPIRequest } = require('./github-api-request')

const getGitGitGadgetOptions = async (context) => {
    const { getInstallationIdForRepo } = require('./get-installation-id-for-repo')
    const installationID = await getInstallationIdForRepo(context, 'gitgitgadget', 'git')
    const { getInstallationAccessToken } = require('./get-installation-access-token')
    const token = await getInstallationAccessToken(context, installationID)

    const api = async (gitPath) => await gitHubAPIRequest(context, token, 'GET', `/repos/gitgitgadget/git/git/${gitPath}`)

    let { object: { sha: commitSHA } } = await api('ref/notes/gitgitgadget')
    let { tree: { sha: treeSHA } } = await api(`commits/${commitSHA}`)
    let name = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' // empty blob
    for (;;) {
        const { tree } = await api(`trees/${treeSHA}`)
        for (const entry of tree) {
            if (entry.path === name) {
                const { content, encoding } = await api(`blobs/${entry.sha}`)
                if (encoding !== 'base64') {
                    throw new Error(`Unexpected encoding ${encoding}`)
                }
                return JSON.parse(Buffer.from(content, 'base64').toString('utf8'))
            }
            if (name.startsWith(entry.path)) {
                name = name.slice(entry.path.length)
                treeSHA = entry.sha
                break
            }
        }
        if (tree.sha === treeSHA) {
            throw new Error('Failed to find ggg options')
        }
    }
}

const isUserAuthorized = async (context, user) => {
    const gggOptions = await getGitGitGadgetOptions(context)
    for (const login of gggOptions.allowedUsers) {
        if (login === user) return true
    }
    return false
}

module.exports = {
    isUserAuthorized
}