
const convertSBIssueToPR = async ({ github, context, exec }) => {
  const eventType = context.eventName; // 'issues' or 'pull_request'
  if (eventType !== 'issues' && eventType !== 'pull_request') {
    throw new Error('This action can only be triggered by issues or pull_request events.');
  }
  const isIssue = eventType === 'issues';
  const issuePRData = isIssue ? context.payload.issue : context.payload.pull_request;

  console.log('issuePRData', issuePRData);

  // // Check if issue is already closed
  // if (context.payload.issue.state === 'closed') {
  //   console.log('Issue is already closed ... skipping');
  //   return;
  // }

  // // Get issue
  // const { data: issue } = await github.rest.issues.get({
  //   ...context.repo,
  //   issue_number: context.issue.number,
  // });
  // issue.body = issue.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Check that its a SB
  issuePRData.body = issuePRData.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const isSB = /^### \[SB\]:/.test(issuePRData.body);
  if (!isSB) {
    console.log('Issue is not a SB ... skipping');
    return;
  }

  // const parsedBody = parseIssueBody(issue.body);
  // console.log(JSON.stringify(parsedBody, null, 2));



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

  const fileName = `${bug_type_letter}EC${Number.parseInt(expected_error_code,)}_${context.issue.number}`;
  const filePath = `compiler_bugs/${fileName}.jai`;

  const code = issuePRData.body.match(/^### Short Code Snippet\n[\S\s]*?```c\n(?<code>[\S\s]*?)```/mi).groups.code;
  console.log('parsed code', code);
  const newFileContent = Buffer.from(code).toString('base64');

  const prBody = issuePRData.body;





  // Because of untrusted code, we will have to update and create the 
  // branch via the API. The alternative is to also validate the PR branch

  // Step 1: Check if the branch exists
  let branchRef = null;
  try {
    branchRef = await github.rest.git.getRef({
      ...context.repo,
      ref: `heads/${branchName}`,
    });

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
      await github.rest.git.createRef({
        ...context.repo,
        ref: `refs/heads/${branchName}`,
        sha: baseBranchRef.data.object.sha,
      });

      // Retrieve the reference of the newly created branch
      branchRef = await github.rest.git.getRef({
        ...context.repo,
        ref: `heads/${branchName}`,
      });

      console.log(`Branch '${branchName}' successfully created.`);
    } else {
      throw error;
    }
  }


  const branchSha = branchRef.data.object.sha;

  // Step 3: Get the current commit and tree
  const branchCommit = await github.rest.git.getCommit({
    ...context.repo,
    commit_sha: branchSha,
  });

  const currentTreeSha = branchCommit.data.tree.sha;

  // Step 4: Prepare the new tree entries
  const tree = await github.rest.git.getTree({
    ...context.repo,
    tree_sha: currentTreeSha,
    recursive: true,
  });

  const newTree = tree.data.tree
    // The bug type or error code may have changed, so we need to delete the old one
    .map(file => {
      if (file.path.includes(String(context.issue.number))) {
        console.log('Deleting file:', file.path);
        return {
          path: file.path,
          mode: file.mode,
          type: file.type,
          sha: null, // Mark file for deletion
        };
      }
      return {
        path: file.path,
        mode: file.mode,
        type: file.type,
        sha: file.sha,
      };
    });

  // Add new file to the tree
  const blob = await github.rest.git.createBlob({
    ...context.repo,
    content: newFileContent,
    encoding: 'base64',
  });

  newTree.push({
    path: filePath,
    mode: '100644', // https://docs.github.com/en/rest/git/trees?apiVersion=2022-11-28
    type: 'blob',
    sha: blob.data.sha,
  });

  // Step 5: Create the new tree
  const newTreeResponse = await github.rest.git.createTree({
    ...context.repo,
    tree: newTree,
    base_tree: currentTreeSha,
  });

  // Check if the new tree is identical to the current tree
  if (newTreeResponse.data.sha !== tree.data.sha) {
    // Step 6: Create a new commit
    const newCommit = await github.rest.git.createCommit({
      ...context.repo,
      message: `[CI] Issue was updated, updating PR branch`,
      tree: newTreeResponse.data.sha,
      parents: [branchSha],
    });

    // Step 7: Update the branch to point to the new commit
    await github.rest.git.updateRef({
      ...context.repo,
      ref: `heads/${branchName}`,
      sha: newCommit.data.sha,
      force: true,
    });

    console.log(`Branch '${branchName}' updated with new commit.`);
  } else {
    console.log('No changes detected. Skipping commit.');
  }


  
  // Convert issue to a pull request
  let pr = null;
  if (isIssue) {
    const { data: prData } = await github.rest.pulls.create({
      ...context.repo,
      head: branchName,
      base: baseBranch,
      body: prBody,
      issue: context.issue.number
    });
    pr = prData;

    // Add the issue owner as an assignee to the PR
    const issueCreator = issuePRData.user.login; // Get the username of the issue creator
    await github.rest.issues.addAssignees({
      ...context.repo,
      issue_number: pr.number,
      assignees: [issueCreator],
    });

    await github.rest.issues.createComment({
      ...context.repo,
      issue_number: context.issue.number,
      body: `👋 Thanks for the contribution @${issueCreator}! If you need to do modifications, you can do so, as long as the PR is not merged yet!`,
    });

  }

  // // Get all open PRs for the branch
  // const prs = await github.rest.pulls.list({
  //   ...context.repo,
  //   head: `${context.repo.owner}:${branchName}`,
  //   state: 'open',
  // });
  
  // // Step 8: Create a Pull Request if it doesnt exist yet
  // if (prs.data.length === 0) {
  //   const pr = await github.rest.pulls.create({
  //   ...context.repo,
  //     title: '[SB]: ' + fileName,
  //     body: prBody,
  //     head: branchName,
  //     base: context.payload.repository.default_branch,
  //   });

  //   console.log(`Created PR: ${pr.data.html_url}`);


  //   Not sure if we should close or lock the original issue
  //   await github.rest.issues.lock({
  //     ...context.repo,
  //     issue_number: context.issue.number,
  //   });

  //   await github.rest.issues.update({
  //     ...context.repo,
  //     issue_number: context.issue.number,
  //     state: 'closed',
  //     state_reason: 'completed'
  //   })


    // Add labels to PR
    const whitelistLabels = ['insert', 'leak'];
    const categories = issuePRData.body.match(/^### Categories\n(?<categories>[\S\s]*?)###/mi)?.groups.categories.trim();
    const categoryLabels = categories.split(', ').map((label) => label.trim()).filter((label) => whitelistLabels.includes(label));
    console.log('categoryLabels', categoryLabels);

    const existingLabelsResponse = await github.rest.issues.listLabelsOnIssue({
      ...context.repo,
      issue_number: issueNumber,
    });

    const existingLabelsToRetain = existingLabelsResponse.data
                                    .map((label) => label.name)
                                    .filter((label) => !whitelistLabels.includes(label)); // remove categories
    console.log('existingLabelsToRetain', existingLabelsToRetain);

    // Add labels to PR
    await github.rest.issues.setLabels({
      ...context.repo,
      issue_number: context.issue.number,
      labels: [...existingLabelsToRetain, ...categoryLabels],
    });

  // } else {
  //   console.log(`PR already exists for branch '${branchName}'.`);
  // }










};

module.exports = convertSBIssueToPR;
