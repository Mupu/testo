function parseIssueCommentBody(issueBody) {
  // Split the input text into lines
  const lines = issueBody.split('\n');
  let pipeLines = lines.filter(line => line.startsWith('|'));
  // Discard the first two lines (header and table)
  pipeLines = pipeLines.slice(2);

  // Extract the row that contains the variable values
  const regex = /\|?(.*?)\|/gm;
  const fields = [...pipeLines[0].matchAll(regex)].map(match => match[1]);

  return fields
}

const handleEmailedIn = async ({ github, context }) => {

  const { data: issue } = await github.rest.issues.get({
    ...context.repo,
    issue_number: context.issue.number
  });
  issue.body = issue.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  let parsedFields = parseIssueCommentBody(issue.body);

  parsedFields[1] = '✅'; // Emailed In

  let modifiedRow = '|' + parsedFields.join('|') + '|';

  // Reassamble updated post
  let lines = issue.body.split('\n');

  // find data row
  let headerIndex = -1;
  for (const [index, line] of lines.entries()) {
    if (line.startsWith('|')) {
      headerIndex = index;
      break;
    }
  }

  lines.splice(headerIndex + 2, 1, modifiedRow);
  const result = lines.join('\n');

  // Update comment
  await github.rest.issues.update({
    ...context.repo,
    issue_number: context.issue.number,
    body: result
  });

}

const handleJonSaid = async ({ github, context, comment }) => {
  // Format the date and time
  const date = new Date().toISOString().split('T')[0];

  const jonSaidBody = comment.body.split(/!JonSaid\s?/i)[1];
  if (jonSaidBody.length <= 25) return;

  const jonSaid = `\n\n${date}\nJon said:\n\`\`\`\n` + jonSaidBody + "\n```";

  // Get old issue body
  const { data: issue } = await github.rest.issues.get({
    ...context.repo,
    issue_number: context.issue.number
  });

  const result = issue.body + jonSaid;

  // Update comment
  await github.rest.issues.update({
    ...context.repo,
    issue_number: context.issue.number,
    body: result
  });
}

module.exports = {
  handleEmailedIn,
  handleJonSaid
};