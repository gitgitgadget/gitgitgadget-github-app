const getInstallationAccessToken = async (context, installation_id) => {
    const { gitHubAPIRequestAsApp } = require('./github-api-request-as-app')
    const answer = await gitHubAPIRequestAsApp(
        context,
        'POST',
        `/app/installations/${installation_id}/access_tokens`)
    if (answer.error) throw answer.error
    if (answer.token) return answer.token
    throw new Error(`Unhandled response:\n${JSON.stringify(answer, null, 2)}`)
}

module.exports = {
    getInstallationAccessToken
}