const validatePRStructure = async ({ github, context }) => {
  await _validatePRStructure({ github, contextRepo: context.repo, prNumber: context.issue.number });
};

// @todo test if folder checks are correct
const _validatePRStructure = async ({ github, contextRepo, prNumber }) => {
  const { data: pr } = await github.rest.pulls.get({
    ...contextRepo,
    pull_number: prNumber
  });

  // Check that its a SB or BB
  const match = pr.title.match(/^\[([SB]B)\]:/)?.[1]
  if (!match) return; // its not a SB or BB, ignore it since its probably a normal PR

  const fileResponse = await github.rest.pulls.listFiles({
    ...contextRepo,
    pull_number: prNumber,
    per_page: 100
  });

  const filePaths = fileResponse.data.map(file => file.filename);

  // @todo also fix validateAddedTestAndMergeOnSuccess
  if (filePaths.length === 100) {
    await github.rest.issues.createComment({
      ...contextRepo,
      issue_number: prNumber,
      body: `@Mupu, This PR has more than 100 files, please make this work and re-run the checks.`
    })
    process.exit(1);
  }

  const isSingleFile = filePaths.length === 1 && (/^compiler_bugs\/EC\d+_\S+\.jai/).test(filePaths[0]);

  const folders = filePaths.map(file => file.split('/').slice(0, -1).join('/'));
  const uniqueFolders = [...new Set(folders)];
  const isSingleFolderWithFirstJaiFile = uniqueFolders.length === 1
    && (/^compiler_bugs\/EC\d+_\S+\//).test(uniqueFolders[0]) // this is redundant because of below?
    && filePaths.some(f => (/^compiler_bugs\/EC\d+_\S+\/first.jai/).test(f));

  console.log(isSingleFile);
  console.log(isSingleFolderWithFirstJaiFile);
  console.log(filePaths);

  // Error, PR doesnt match needed structure
  if (!isSingleFile && !isSingleFolderWithFirstJaiFile) {
    process.exit(1);
  }
};

// This is run after a SB/BB PR has been manually approved
// It should run in the context of the PR branch
const validateAddedTestAndMergeOnSuccess = async ({ github, exec, io, contextRepo, prNumber }) => {
  console.log(`Validating Pull Request #${prNumber}...`);

  const { data: pr } = await github.rest.pulls.get({
    ...contextRepo,
    pull_number: prNumber
  });

  // Check that its a SB or BB
  const match = pr.title.match(/^\[([SB]B)\]:/)?.[1]
  if (!match) process.exit(1); // should never happen, as we already checked this in validatePRStructure
  const isSingleFile = match === 'SB'; // false means its a BB

  console.log(isSingleFile);
  
  const fileResponse = await github.rest.pulls.listFiles({
    ...contextRepo,
    pull_number: prNumber,
    per_page: 100
  });
  const filePaths = fileResponse.data.map(file => file.filename);
  console.log(filePaths);

  // @todo rework this to work with multi platform
  // Make sure the test actually fails
  const fileToRun = isSingleFile ? filePaths[0] : filePaths.find(f => (/^compiler_bugs\/EC\d+_\S+\/first.jai/).test(f));
  const exitCode = await exec.exec('jai ' + fileToRun, [], { ignoreReturnCode: true });
  const expectedExitCode = Number.parseInt(fileToRun.match(/(?<=EC)(\d+)(?=_\S+)/)[0]);
  console.log(exitCode);  
  console.log(expectedExitCode);  
  if (exitCode === expectedExitCode) {
    console.error(`Test failed as expected, exit code: ${exitCode} .. skipping`);
    process.exit(1);
  }
  
  const createTrackingIssueFromPR = require('./create_tracking_issue_from_PR.js');
  const trackingIssueNumber = await createTrackingIssueFromPR({ github, contextRepo, prNumber });
  
  const path = require('path');
  const fs = require('fs');
  function listFilesInDirectorySync(dirPath) {
    try {
      const files = fs.readdirSync(dirPath);
      console.log('Files in directory:', files);
      return files;
    } catch (error) {
      console.error(`Error reading directory: ${error}`);
    }
  }
  listFilesInDirectorySync('compiler_bugs');

  // We already know that the structure is valid, so we can just take the first file
  if (isSingleFile) {
    const oldFileName = filePaths[0];
    const newFileName = oldFileName.replace(/(?<=^compiler_bugs\/EC\d+_)(\S+)(?=\.jai)/, trackingIssueNumber);
    console.log(newFileName);
    await io.mv(oldFileName, newFileName);
  } else { // BB, folder structure
    const oldFolderName = filePaths[0].split('/').slice(0, -1).join('/');
    const newFolderName = oldFolderName.replace(/(?<=^compiler_bugs\/EC\d+_)(\S+)/, trackingIssueNumber);
    console.log(newFolderName);
    await io.mv(oldFolderName, newFolderName);
  }

  console.log('sha1')
  await exec.exec('git', ['rev-parse', 'HEAD']);

  // Git commands to add, commit, and push changes
  await exec.exec('git', ['config', 'user.name', 'github-actions[bot]']);
  await exec.exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
  await exec.exec('git', ['status']);
  await exec.exec('git', ['add', '--all']);
  await exec.exec('git', ['commit', '-m', 'Updated file paths to match tracking issue number']);
  await exec.exec('git', ['push']);
  
  console.log('sha')
  await exec.exec('git', ['rev-parse', 'HEAD']);

  
  const { data: commit } = await github.rest.repos.getBranch({
    ...contextRepo,
    branch: 'issue-224'
  });
  const latestSha = commit.commit.sha;
  console.log(`Latest commit SHA on ${branch}: ${latestSha}`);

  // Not sure why the merge below only works after Checking out the PR again.
  // If we dont do this, the merge will fail with 'Head branch is out of date'
  // Currently, we work around this by checking out the PR branch again

  console.log('trying to merge')

  const { data: pr2 } = await github.rest.pulls.get({
    ...contextRepo,
    pull_number: prNumber
  });
  console.log('pr2', pr2);

  const mergeResponse = await github.rest.pulls.merge({
    ...contextRepo,
    pull_number: prNumber,
    merge_method: 'squash'  // Use 'merge', 'squash', or 'rebase' depending on your needs
  });
  console.log(mergeResponse);
};

module.exports = {
  validatePRStructure,
  _validatePRStructure,
  validateAddedTestAndMergeOnSuccess
};