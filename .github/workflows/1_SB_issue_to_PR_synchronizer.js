
// Also update issue_template and pull_request_template to include the following:
const whitelistedLabels = ['insert', 'leak'];


// Apart from the labels and the correct checkout, we should not have to care about any security.
// This workflow is only supposed to convert the issue into a PR and forward edits to the PR
// to the PR branch. The only thing it enforces is the PR body and that its only one file in the PR.
// We don't support forked SB PRs, because it doesn't make much sense.
const convertSBIssueToPRAndSynchronize = async ({ github, context }) => {
  const eventType = context.eventName; // 'issues' or 'pull_request'
  console.log('eventType', eventType);
  const isIssue = eventType === 'issues';
  const issuePRData = isIssue ? context.payload.issue : context.payload.pull_request;
  issuePRData.body = issuePRData.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  console.log('issuePRData', JSON.stringify(issuePRData, null, 2));

  const state = issuePRData.state;
  console.log('state', state);

  // Issue/PR must be open
  if (state !== 'open') {
    console.log('Issue/PR is not open ... skipping');
    return;
  }

  // Make sure its a SB
  const isSB = /^\[SB\] /.test(issuePRData.title);
  if (!isSB) {
    console.log('Issue is not a SB ... skipping');
    return;
  }

  // Forks are not supported
  if (!isIssue && issuePRData.head.repo.fork) {
    console.log('SB PR is only supported for non-forked repositories ... skipping');
    return;
  }


  // Get issue, since its a converted issue, we need to get the original issue
  // instead of the PR, to get the originial issue creator
  const { data: originalIssue } = await github.rest.issues.get({
    ...context.repo,
    issue_number: context.issue.number,
  });
  originalIssue.body = originalIssue.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const originialIssueCreator = isIssue ? issuePRData.user.login : originalIssue.user.login;
  console.log('originialIssueCreator', originialIssueCreator);



  // A few variables we need for the PR
  const branchName = `issue-${context.issue.number}`;
  const baseBranch = context.payload.repository.default_branch;

  const bug_type = issuePRData.body.match(/^### Bug Type\n\n(?<type>(?:Compiletime)|(?:Runtime))/mi)?.groups.type
  if (!bug_type) {
    throw new Error('Bug Type not found. Most likely the issue was not formatted correctly after editing.');
  }
  const bug_type_letter = bug_type[0].toUpperCase(); // C or R

  const expected_error_code = issuePRData.body.match(/^### Expected Error Code\n\n(?<errorCode>-?\d+)/mi)?.groups.errorCode
  if (!expected_error_code) {
    throw new Error('Expected Error Code not found. Most likely the issue was not formatted correctly after editing.');
  }

  const categories = issuePRData.body.match(/^### Categories\n(?<categories>[\S\s]*?)###/mi)?.groups.categories.trim();
  if (!categories) {
    throw new Error('Categories not found. Most likely the issue was not formatted correctly after editing.');
  }

  let code = issuePRData.body.match(/^### Short Code Snippet\n[\S\s]*?```c\n(?<code>[\S\s]*?)```/mi)?.groups.code;
  if (!code) {
    throw new Error('Code Snippet not found. Most likely the issue was not formatted correctly after editing.');
  }
  code = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  console.log('parsed code', code);



  // '0' will be replaced with the tracker id later on
  const fileName = `0_${context.issue.number}_${bug_type_letter}EC${Number.parseInt(expected_error_code)}`; 
  let filePath = `compiler_bugs/${fileName}.jai`;



  // Delete old file if it exists, create new file, commit if it changed
  // We use this verbose api to avoid 2 separate commits, because we have
  // to rename a file, when for example the error code changes.
  {
    // Check if the branch exists or create it
    let branchSha = null;
    try {
      const branchRef = await github.rest.git.getRef({
        ...context.repo,
        ref: `heads/${branchName}`,
      });
      branchSha = branchRef.data.object.sha

      console.log(`Branch '${branchName}' already exists.`);
    } catch (error) {
      if (error.status === 404) {
        // Branch does not exist, create it
        console.log(`Branch '${branchName}' does not exist. Creating it...`);

        // Get the default branch (e.g., main) as the base
        const { data: defaultBranch } = await github.rest.repos.get({
          ...context.repo,
        });
        const baseBranch = defaultBranch.default_branch;

        // Get the SHA of the default branch
        const baseBranchRef = await github.rest.git.getRef({
          ...context.repo,
          ref: `heads/${baseBranch}`,
        });

        // Create the new branch
        const createRefResponse = await github.rest.git.createRef({
          ...context.repo,
          ref: `refs/heads/${branchName}`,
          sha: baseBranchRef.data.object.sha,
        });
        branchSha = createRefResponse.data.object.sha

        console.log(`Branch '${branchName}' successfully created.`);
      } else {
        throw error;
      }
    }

    // Get the current commit and tree
    const branchCommit = await github.rest.git.getCommit({
      ...context.repo,
      commit_sha: branchSha,
    });
    const currentTreeSha = branchCommit.data.tree.sha;

    // Prepare the new tree entries
    const tree = await github.rest.git.getTree({
      ...context.repo,
      tree_sha: currentTreeSha,
      recursive: true,
    });

    

    // Create the new blob aka file content
    const blob = await github.rest.git.createBlob({
      ...context.repo,
      content: Buffer.from(code).toString('base64'),
      encoding: 'base64',
    });

    // This code does not prevent the user from having more files with different names in the PR
    // But this will be caught by the validation later on
    const validBugNameRegexTemplate = `^compiler_bugs/\\d+_${context.issue.number}_[CR]EC-?\\d+\\.jai$`; // @copyPasta
    const validBugNameRegex = new RegExp(validBugNameRegexTemplate);
    let replacedFile = false;
    const newTree = tree.data.tree
      // The bug type or error code may have changed, so we need to delete the old one
      .flatMap(file => {
        if (validBugNameRegex.test(file.path)) {
          console.log('Changing Content of file:', file.path);
          if (replacedFile) {
            throw new Error('Expected exactly 1 file in a SB PR');
          } else {
            replacedFile = true;
          }
          // In case file.path == filePath, the latter will be used
          return [
            {
              path: file.path,
              mode: file.mode,
              type: file.type,
              sha: null, // Mark the original file for deletion
            },
            {
              path: filePath,
              mode: file.mode,
              type: file.type,
              sha: blob.data.sha, // Replace the file content
            }
          ];
        }
        return file;
      });


    // If the file was not replaced, add it
    if (!replacedFile) {
      console.log('Adding file:', filePath);
      newTree.push({
        path: filePath,
        mode: '100644', // https://docs.github.com/en/rest/git/trees?apiVersion=2022-11-28
        type: 'blob',
        sha: blob.data.sha,
      });
    }

    // Create the new tree
    const newTreeResponse = await github.rest.git.createTree({
      ...context.repo,
      tree: newTree,
      base_tree: currentTreeSha,
    });

    // Check if the new tree is identical to the current tree
    // to avoid empty commits
    if (newTreeResponse.data.sha !== tree.data.sha) {
      // Create a new commit
      const newCommit = await github.rest.git.createCommit({
        ...context.repo,
        message: `[CI] Issue was updated, updating PR branch`,
        tree: newTreeResponse.data.sha,
        parents: [branchSha],
      });

      // Update the branch to point to the new commit
      await github.rest.git.updateRef({
        ...context.repo,
        ref: `heads/${branchName}`,
        sha: newCommit.data.sha,
        // force: true,         // Fail if a new update happened, and restart this workflow
      });

      console.log(`Branch '${branchName}' updated with new commit.`);
    } else {
      console.log('No changes detected. Skipping commit.');
    }
  }



  // Convert issue to PR if it isn't already
  if (isIssue) {
    console.log('Converting Issue to PR');
    const { data: prData } = await github.rest.pulls.create({
      ...context.repo,
      head: branchName,
      base: baseBranch,
      body: issuePRData.body,
      issue: context.issue.number
    });

    // Add the issue owner as an assignee to the PR
    await github.rest.issues.addAssignees({
      ...context.repo,
      issue_number: prData.number,
      assignees: [originialIssueCreator],
    });

    await github.rest.issues.createComment({
      ...context.repo,
      issue_number: context.issue.number,
      body: `👋 Thanks for the contribution @${originialIssueCreator}! If you need to do modifications, you can do so, as long as the PR is not merged yet!`,
    });
  } else {
    console.log('Issue was already converted to PR');
  }



  // Always update the PR labels
  const categoryLabels = categories.split(',')
                            .map((label) => label.trim())
                            .filter((label) => whitelistedLabels.includes(label));
  console.log('categoryLabels', categoryLabels);

  const existingLabelsResponse = await github.rest.issues.listLabelsOnIssue({
    ...context.repo,
    issue_number: context.issue.number,
  });

  const existingLabelsToRetain = existingLabelsResponse.data
                                  .map((label) => label.name)
                                  .filter((label) => !whitelistedLabels.includes(label)); // remove categories
  console.log('existingLabelsToRetain', existingLabelsToRetain);

  // Add labels to PR
  await github.rest.issues.setLabels({
    ...context.repo,
    issue_number: context.issue.number,
    labels: [...existingLabelsToRetain, ...categoryLabels],
  });

};

module.exports = convertSBIssueToPRAndSynchronize;
