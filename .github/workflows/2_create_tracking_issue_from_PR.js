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

### Latest Test Outputs
---
\`\`\`
No test outputs available
\`\`\`

---

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
  // Load the file paths instead of querying them again because of race conditions
  const fs = require('fs');
  const filePaths = JSON.parse(fs.readFileSync('pr_files.json', 'utf-8'));
  console.log('loaded pr_files.json', filePaths);

  // We know the PR structure is valid, so we can just take any file
  const prFile = filePaths[0];
  // Extract the tracker issue number from the file path
  const trackerIssueNumber = parseInt(prFile.match(/compiler_bugs\/(\d+)_\d+_[CR]EC-?\d+(?:\.jai$|\/)/)[1]);
  if (isNaN(trackerIssueNumber)) {
    throw new Error('Invalid tracker issue number found in file path. Should never happen, because of validation before!');
  }
  if (trackerIssueNumber !== 0) {
    console.log('Tracker issue number already set, skipping creation');
    return trackerIssueNumber;
  }


  console.log('Creating tracker issue...');

  // Parse PR body
  const parsedBody = parsePrBody(originalPRData.body);
  console.log('parsed PR Body', parsedBody);
  
  // Create Tracking Issue
  const { format } = require('./_utils.js');
  const issueTitle = `[TRACKER] PR #${context.issue.number}`;
  const issueBody = format(issueTrackerTemplate, parsedBody);

  const { data: issue } = await github.rest.issues.create({
    ...context.repo,
    title: issueTitle,
    body: issueBody,
    labels: originalPRData.labels.map((label) => label.name),
  });


  //
  // NOTE: if the workflow got cancelled right here, the comment on the 
  // tracker would get lost. But its not a big deal. :cancelInProgress
  //
  // @todo maybe read out comments even if exist
  // and add if it wasnt there. Doesnt seem worth it though
  //
  
  // Get issue, since its a converted issue, and we want to get the original creator
  const { data: originalIssue } = await github.rest.issues.get({
    ...context.repo,
    issue_number: context.issue.number,
  });
  const originialIssueCreator = originalIssue.user.login;
  console.log('originialIssueCreator', originialIssueCreator);

  // Notify the original issue creator and link the PR number
  await github.rest.issues.createComment({
    ...context.repo,
    issue_number: issue.number,
    body: `👋 Thanks for the contribution @${originialIssueCreator}. This is the tracker for the PR #${context.issue.number}. If you want to get notified when this issue is fixed, or breaks again, subscribe to this issue!`,
  });

  return issue.number;
}

// We force push all changes, since its the only way for us to commit and be sure 
// that no other commits got in the way, that we dont trust.
const renameAllFilesToMatchTracker = async ({ github, context, originalPRData, validatedCommitSha, trackerIssueNumber }) => {
  // In case its a fork we need to push to IT, instead of our own repo
  let repo = null;
  if (originalPRData.head.repo.fork) {
    repo = {
      owner: originalPRData.head.repo.owner.login,
      repo: originalPRData.head.repo.name,
    };
  } else {
    repo = context.repo;
  }

  // Fetch the commit and its tree
  const { data: commit } = await github.rest.git.getCommit({
    ...repo,
    commit_sha: validatedCommitSha // Even if its in a fork, we know its our trusted commit
  });

  const { data: tree } = await github.rest.git.getTree({
    ...repo,
    tree_sha: commit.tree.sha,
    recursive: true
  });

  // Update the tree by renaming files of this PR to match the tracker issue number
  // <tracking_issue_number>_<PRNumber>[C|R]EC<exit_code>.jai @copyPasta
  const validBugNameRegexTemplate = `^compiler_bugs/{TRACKERNUMBER}_${context.issue.number}_[CR]EC-?\\d+(?:\\.jai$|/)`; // @copyPasta
  // When running the first time, the trackerIssueNumber is 0, so we need to replace it with the actual number
  const validBugNameNoTrackerRegex = new RegExp(validBugNameRegexTemplate.replace('{TRACKERNUMBER}', 0));
  const validBugNameAnyTrackerRegex = new RegExp(validBugNameRegexTemplate.replace('{TRACKERNUMBER}', '\\d+'));
  if (!tree.tree.some(file => validBugNameAnyTrackerRegex.test(file.path))) {
    throw new Error('No files of this PR found. Should never happen, because of validation before!');
  }
  const updatedTree = tree.tree.flatMap(file => {
    if (validBugNameNoTrackerRegex.test(file.path)) { // Found one that wasn't renamed yet
      // If the file matches, rename it and mark the old one for deletion
      return [
        {
          path: file.path.replace(/^compiler_bugs\/0_/, `compiler_bugs/${trackerIssueNumber}_`), // only replace first occurence
          mode: file.mode,
          type: file.type,
          sha: file.sha, // Keep the file content for the renamed file
        },
        {
          path: file.path,
          mode: file.mode, // Preserve the original mode
          type: file.type, // Preserve the original type
          sha: null, // Mark the original file for deletion
        },
      ];
    } else {
      // If the file doesn't match, return it unchanged
      return file;
    }
  });

  // Create a new tree
  const { data: newTree } = await github.rest.git.createTree({
  ...repo,
    tree: updatedTree,
    base_tree: commit.tree.sha, // our trusted commit
  });

  // No changes, for example when just the merge had an error and we re-run the workflow
  // NOTE: This should be fine even if canceled and re-run, since the commit is the
  // not 'active' until updateRef happened. If that goes through, we are fine. :cancelInProgress
  if (newTree.sha !== tree.sha) {
    console.log('Renaming files to match tracker issue number...');
    // Create a new commit with the updated tree
    const { data: newCommit } = await github.rest.git.createCommit({
      ...repo,
      message: `[CI] Renamed files to use tracker issue number '${trackerIssueNumber}'`,
      tree: newTree.sha,
      parents: [validatedCommitSha]
    });

    // Force push the new commit
    await github.rest.git.updateRef({
      ...repo,
      // ref: `heads/issue-${originalPRData.number}`,
      ref: `heads/${originalPRData.head.ref}`,
      sha: newCommit.sha,
      force: true        // VERY IMPORTANT: Force push to overwrite any untrusted changes
    });

    return newCommit.sha
  }

  // No changes, return the original commit sha
  console.log('No changes, skipping renaming files');
  return validatedCommitSha;
};


module.exports = {
  createTrackingIssueFromPR,
  renameAllFilesToMatchTracker,
};
