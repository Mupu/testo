
// This is run after a SB/BB PR has been manually approved
// It should run in the context of the PR branch
const validateAddedTestAndMergeOnSuccess = async ({
  github,
  exec,
  io,
  context,
  isSingleFile,
}) => {
  console.log(context)
  console.log(`Manual approval was given for Pull Request #${context.issue.number}...`);

  // Load the files that were added in the PR
  const fs = require('fs');
  const filePaths = JSON.parse(fs.readFileSync('pr_files.json', 'utf-8'));
  console.log('loaded pr_files.json', filePaths);



  //
  // Run the test and see if it fails as expected
  //

  const validBugNameRegexTemplate = `^compiler_bugs/[CR]EC-?\\d+_${context.issue.number}`; // @copyPasta
  const validFirstJaiRegex = new RegExp(`${validBugNameRegexTemplate}/first\\.jai`);
  const fileToRun = isSingleFile
    ? filePaths[0]
    : filePaths.find((f) => validFirstJaiRegex.test(f));

  const exitCode = await exec.exec('jai ' + fileToRun, [], {
    ignoreReturnCode: true, // make this not throw an error when non 0 exit code
  });
  const expectedExitCode = Number.parseInt(
    fileToRun.match(/(?<=[CR]EC)-?\d+(?=_)/)[0],
  );
  console.log('exitCode', exitCode);
  console.log('expectedExitCode', expectedExitCode);
  if (exitCode === expectedExitCode) {
    throw new Error(`Test already passes, exit code: ${exitCode}, expected ${expectedExitCode}`);
  }





  // @todo make this only be run once when the pr has only one commit?
  // but this hole thing here should only be run once, or error before?
  // const createTrackingIssueFromPR = require('./2.1_PR_to_tracking_issue.js');
  // const trackingIssueNumber = await createTrackingIssueFromPR({ github, context});

  


  // Try to merge the PR, we have to wait until the push has been processed
  // const maxRetries = 3;
  // const delayMs = 10000;
  // for (let attempt = 1; attempt <= maxRetries; attempt++) {
  //   try {
  //     console.log(`Attempt ${attempt}: Merging pull request #${context.issue.number}`);

  //     const mergeResponse = await github.rest.pulls.merge({
  //       ...context.repo,
  //       pull_number: context.issue.number,
  //       merge_method: 'squash', // Use 'merge', 'squash', or 'rebase'
  //     });

  //     console.log(`Merge successful: ${mergeResponse.data.message}`);
  //     return mergeResponse; // Exit after successful merge
  //   } catch (error) {
  //     console.log(`Error during merge attempt ${attempt}: ${error.message}`);

  //     // Retry if it's a merge conflict or related to a temporary issue
  //     if (attempt < maxRetries) {
  //       console.log(`Retrying after ${delayMs}ms...`);
  //       await new Promise((resolve) => setTimeout(resolve, delayMs)); // Wait for the specified delay
  //     } else {
  //       console.log(`Failed to merge after ${maxRetries} attempts.`);
  //       process.exit(1); // Exit if all retries fail
  //     }
  //   }
  // }
}

module.exports = {
  validateAddedTestAndMergeOnSuccess,
};
