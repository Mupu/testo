// :trackerTemplate
const issueTrackerTemplate = `
| Emailed In |  Reported Version | Latest Broken Version | Latest Broken Platforms  | Fix Version |
| :---: | :---: | :---: | :---: | :---: |
| {alreadyReported} | - | - | - | - |

### Description
\`\`\`
{description}
\`\`\`

### Buggy Code
\`\`\`c
{code}
\`\`\`

### Workarounds
\`\`\`c
{workaround}
\`\`\`

### History V1
| Version | Windows | Linux | Mac |
| :-------: | :-------------: | :-------------: | :-------------: |
| - | - | - | - |
`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

// Parse PR Body of SB/BB template
function parsePrBody(text) {
  // match the x inside the 3. checkbox (hoepfully emailed in)
  const regexEmailedIn = /(?<=(?:- \[[ X]\] .*\s){2}- \[)([ X])(?=\])/im;

  const regexDescription =
    /(?<=^### Bug Description[\s\S]*$\s\s)([\s\S]*?)(?=\s\s###)/im;
  const regexWorkaround =
    /(?<=^### Workarounds[\s\S]*$\s\s)([\s\S]*)/im; // greedy match since its at the bottom
  const regexCode =
    /(?<=^### Short Code Snippet[\s\S]*$\s\s```c\s)([\s\S]*?)(?=\s```\s+###)/im; // match the code only

  let parsedData = {
    alreadyReported:(text.match(regexEmailedIn)?.[1] || ' ').toLowerCase() === 'x' ? '✅' : '❌',
    description: (text.match(regexDescription)?.[1] || '-').replace(/_No response_/, '-'),
    workaround: (text.match(regexWorkaround)?.[1] || '-').replace(/_No response_/, '-'),
    code: (text.match(regexCode)?.[1] || '-').replace(/_No response_/, '-'),
  };

  return parsedData;
}

const createTrackingIssueFromPR = async ({ github, context, originalPRData }) => {
  // Search of existing tracker, sadly we dont know the trackers issue number, so we use the PR number to find it
  const query = `repo:${context.repo.owner}/${context.repo.repo} is:issue in:title TRACKER PR ${context.issue.number}`;
  const searchResults = await github.rest.search.issuesAndPullRequests({
    q: query,
    per_page: 100 // Fetch up to 100 results
  });

  const existingIssue = searchResults.data.items;
  console.log('existingIssue', existingIssue);
  if (existingIssue.length > 0) {
    if (existingIssue.length > 1) {
      throw new Error('Multiple trackers found, this should not happen! Most likely it clashes with another PR. Manual intervention required.');
    }
    if (existingIssue[0].title === `[TRACKER] (PR #${context.issue.number})`) {
      // @todo check that it matches template
      // :trackerTemplate
      if (true) {
        console.log('Tracker already exists, skipping');
        return existingIssue[0].number;
      }
    } else {
      throw new Error('Tracker found, but does not match the template. Manual intervention required.');
    }
  }


  console.log('Creating tracker issue...');

  // Parse PR body
  const parsedBody = parsePrBody(originalPRData.body);
  console.log('parsed PR Body', parsedBody);
  
  // Create Tracking Issue
  const { format } = require('./_utils.js');
  const issueTitle = `[TRACKER] (PR #${context.issue.number})`; // if this changes, also change the tracker search query
  const issueBody = format(issueTrackerTemplate, parsedBody);
  const { data: issue } = await github.rest.issues.create({
    ...context.repo,
    title: issueTitle,
    body: issueBody,
    labels: originalPRData.labels.map((label) => label.name),
  });


  
  // Get issue, since its a converted issue, and we want to get the original creator
  const { data: originalIssue } = await github.rest.issues.get({
    ...context.repo,
    issue_number: context.issue.number,
  });
  const originialIssueCreator = originalIssue.user.login;
  console.log('originialIssueCreator', originialIssueCreator);

  // Notify the original issue creator
  await github.rest.issues.createComment({
    ...context.repo,
    issue_number: issue.number,
    body: `👋 Thanks for the contribution @${originialIssueCreator}. We will notify you when this issue was fixed, or breaks again!`,
  });

  return issue.number;
}

// We force overwite all changes, since its the only way for us to commit and be sure 
// that no other commits got in the way, that we dont trust.
const renameAllFilesToMatchTracker = async ({ github, context, originalPRData, validatedCommitSha, trackerIssueNumber }) => {
  // Fetch the commit and its tree
  const { data: commit } = await github.rest.git.getCommit({
    ...context.repo,
    commit_sha: validatedCommitSha
  });

  const { data: tree } = await github.rest.git.getTree({
    ...context.repo,
    tree_sha: commit.tree.sha,
    recursive: true
  });

  // Update the tree by renaming files
  const validBugNameRegex = /^compiler_bugs\/[CR]EC-?\d+_new/; // @copyPasta
  const updatedTree = tree.tree.map(file => {
    // Skip files that don't match the pattern
    if (!validBugNameRegex.test(file.path)) {
      return file;
    }
    return {
      path: file.path.replace(/_new/, `_${trackerIssueNumber}`),
      mode: file.mode,
      type: file.type,
      sha: file.sha
    };
  });

  // Create a new tree
  const { data: newTree } = await github.rest.git.createTree({
    ...context.repo,
    tree: updatedTree
  });

  // Create a new commit with the updated tree
  const { data: newCommit } = await github.rest.git.createCommit({
    ...context.repo,
    message: `Renamed files to use tracker issue number '${trackerIssueNumber}'`,
    tree: newTree.sha,
    parents: [validatedCommitSha]
  });

  // Force push the new commit
  await github.rest.git.updateRef({
    ...context.repo,
    ref: `heads/issue-${originalPRData.number}`,
    sha: newCommit.sha,
    force: true
  });

  return newCommit.sha
};


module.exports = {
  createTrackingIssueFromPR,
  renameAllFilesToMatchTracker,
};
