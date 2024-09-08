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
  console.log(fileResponse);

  // Error, PR doesnt match needed structure
  if (!isSingleFile && !isSingleFolderWithFirstJaiFile) {
    process.exit(1);
  }
};

// This is run after a SB/BB PR has been manually approved
// It should run in the context of the PR branch
const validateAddedTestAndMergeOnSuccess = async ({ github, exec, io, contextRepo, prNumber, prRef }) => {
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

  // check that test crashes / is != expected return code
  // get files so we know what to run
  
  // const createTrackingIssueFromPR = require('./create_tracking_issue_from_PR.js');
  // const trackingIssueNumber = await createTrackingIssueFromPR({ github, contextRepo, prNumber });
  
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
    const newFileName = oldFileName.replace(/(?<=^compiler_bugs\/EC\d+_)(\S+)(?=\.jai)/, 666); // @todo tracking issue number
    console.log(newFileName);
    await io.mv(oldFileName, newFileName);
  } else { // BB, folder structure
    const oldFolderName = filePaths[0].split('/').slice(0, -1).join('/');
    const newFolderName = oldFolderName.replace(/(?<=^compiler_bugs\/EC\d+_)(\S+)/, 666); // @todo tracking issue number
    console.log(newFolderName);
    await io.mv(oldFolderName, newFolderName);
  }

  // Git commands to add, commit, and push changes
  await exec.exec('git', ['config', 'user.name', 'github-actions[bot]']);
  await exec.exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
  await exec.exec('git', ['add', '--all']);
  await exec.exec('git', ['commit', '-m', 'Updated file paths via GitHub Actions']);
  // await exec.exec('git', ['push']);
  await exec.exec('git', ['push', 'origin', `HEAD:${prRef}`]);


  // if test crashes, merge PR
  // const mergeResponse = await github.pulls.merge({
  //   owner: context.repo.owner,
  //   repo: context.repo.repo,
  //   pull_number: prNumber,
  //   merge_method: 'merge'  // Use 'merge', 'squash', or 'rebase' depending on your needs
  // });

  // if (mergeResponse.status === 200) {
  //   console.log(`Pull Request #${prNumber} merged successfully.`);
  // } else {
  //   console.error(`Failed to merge Pull Request #${prNumber}.`);
  //   process.exit(1);  // Exit with failure
  // }
};

module.exports = {
  validatePRStructure,
  _validatePRStructure,
  validateAddedTestAndMergeOnSuccess
};