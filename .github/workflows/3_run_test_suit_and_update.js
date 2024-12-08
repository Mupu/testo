const { makeExtendedRegExp } = require('./_utils.js');

// Make sure the regex capture groups stay the same :regexGroupNames
// When a new platform is added update :platformSpecific 
// :trackerTemplate
const parseIssueHeaderRegex = makeExtendedRegExp(String.raw`
  (?<=\| :-.*$\s)          # Match and skip table data splitter | :-: | :-: | :-: | :-: | + newline

  # Match and capture the table data
  \| (?<emailedIn>.*?) \| (?<reportedVersion>.*?) \| (?<latestBrokenVersion>.*?) \| (?<latestBrokenPlatforms>.*?) \| (?<fixVersion>.*?) \| 
`,
  'm', // Flags
);

// If a colum is added that is not a platform, it has to be added here :historyColumns
// When changine this, make sure to update the migration below. Also we leave old version
// for reference.
// :trackerTemplate
const parseIssueHistoryRegexV1 = makeExtendedRegExp(String.raw`
  (?<=\#\#\# History V\d+$\s(?:.*$\s){2,})              # Match and skip the history header + skip to data
  \| (?<version>.*?) \| (?<windows>.*?) \| (?<linux>.*?) \| (?<mac>.*?) \|\s?        # Match row data
`,
  'mig', // Flags
);

const parseIssueHistoryRegex = parseIssueHistoryRegexV1;

const parseIssueHistoryVersion = /### History V(?<version>\d+)$\s(?:.*$\s){2}\|/im;

function migrateIssueHistory(issueBody) {
  let newIssueBody = issueBody;
  const historyVersion = issueBody.match(parseIssueHistoryVersion)?.groups.version;
  if (!historyVersion) {
    console.log('Problematic issue body:', issueBody);
    throw new Error('No history version found in issue body');
  }
  switch (historyVersion) { // fall through to update to latest version
    case '0': // dummy
    // case '1': // Migrate from V1 to V2
      // Example:
      // 
      // // replace row data
      // newIssueBody = newIssueBody.replace(parseIssueHistoryRegexV1, (match, ...args) => {
      //     const row = args.pop(); // grep the groups object
      //     return `| ${row.version} | - | ${row.linux} |\n`;
      //   },
      // );
      // // replace history table header
      // newIssueBody = newIssueBody.replace(
      //   /### History V1\n\| Version \| Linux \|\n\| :-+: \| :-+: \|/,
      //   '### History V2\n\| Version \| Windows \| Linux \|\n\| :-------: \| :-------: \| :-------: \|',
      // );

    // case '2': // Migrate from V1 to V2

    
    console.log('Migration successful');
    console.log('Old Issue Body:', issueBody);
    console.log('New Issue Body:', newIssueBody);
    break;
    default:
  }
  return newIssueBody;
}



// We use this so we have to change fewer places when adding a new platform
function getGroupNames(regex) {
  const pattern = /\(\?<(\w+)>/g;
  const groupNames = [];
  let match;
  while ((match = pattern.exec(regex.source)) !== null) {
    groupNames.push(match[1]);
  }
  return groupNames;
}



const runTestSuitAndGatherOutput = async ({ github, context, exec, io }) => {
  const path = require('path');
  const fs = require('fs');
  const {
    getCurrentJaiVersion,
    decrementVersionString,
  } = require('./_utils.js');

  const platform = process.env.RUNNER_OS.toLowerCase();
  console.log(`Running on platform: ${platform}`);

  const currentJaiVersion = await getCurrentJaiVersion({ exec });

  // FORMAT:
  // {
  //  "264": { // tracking_issue_number
  //    "beta-0.1.093": {
  //      "linux": {
  //        "compilation_exit_code": 1,
  //        "expected_compilation_exit_code": 1,
  //        "expected_run_exit_code": -1,
  //        "is_runtime_test": false,
  //        "passed_test": true,
  //        "run_exit_code": -1
  //        "compiler_output": "..."
  //        "compiler_error_output": "..."
  //        "runtime_output": "..."
  //        "runtime_error_output": "..."
  //      }
  //    },
  //    "file_path": "compiler_bugs/264_0_CEC1.jai",
  //    "tracking_issue_number": 264
  //  },
  //   ...
  // }
  // Get old state of test results
  let oldTestResults = {};
  try {
    const data = fs.readFileSync('old_test_results.json', 'utf8');
    oldTestResults = JSON.parse(data);
  } catch (err) {
    console.log('Error reading file:', err);
  }

  // Get compiler path
  let compilerPath = await io.which('jai'); // we start with the current one
  try {
    // Get the real path, if its a symlink
    compilerPath = fs.readlinkSync(compilerPath);
  } catch (err) {} // ignore error
  console.log('Running for version:', currentJaiVersion);
  console.log('compilerPath', compilerPath);
  
  
  
  // Run test suit for all tests
  const options = { silent: false };
  await exec.exec(`${compilerPath} bug_suit.jai`, [], options);



  // Get new test results
  // NOTE: this data could get extended in the handling code of new tests, to
  //       add more results of older compiler versions!
  let newTestResults = {};
  try {
    const data = fs.readFileSync('test_results.json', 'utf8');
    newTestResults = JSON.parse(data);
  } catch (err) {
    console.log('Error reading file:', err);
  }

  const oldTestIssueNumbers = Object.keys(oldTestResults);
  const newTestIssueNumbers = Object.keys(newTestResults);



  // Find all tests that were added. We need this to gather extra results
  const newIssueNumbers = newTestIssueNumbers.filter(
    (item) => !oldTestIssueNumbers.includes(item),
  );
  console.log('newIssueNumbers', JSON.stringify(newIssueNumbers, null, 2));



  // Run the test suit for all older compiler versions for each new test
  // We will only run the test suit for theses tests, instead of all tests
  for (const currentIssueNumber of newIssueNumbers) {
    console.log('handle newTest', JSON.stringify(newTestResults[currentIssueNumber], null, 2));

    // Run older compiler versions for this test
    let suffix = ''; // :platformSpecific
    if (platform === 'linux') suffix = '-linux';
    if (platform === 'macos') suffix = '-macos';
    let tempVersion = currentJaiVersion;
    const filePath = newTestResults[currentIssueNumber].file_path;

    while (true) {
      const extension = path.extname(compilerPath);
      tempVersion = decrementVersionString(tempVersion);
      // hardcoded paths, that are relative to the compiler path
      const newCompilerPath =
        path.resolve(compilerPath, '..', '..', '..', `jai-${tempVersion}/bin`) +
        `${path.sep}jai${suffix}${extension}`;

      if (!fs.existsSync(newCompilerPath)) break;
      console.log('Running for version:', tempVersion);
      console.log('newCompilerPath', newCompilerPath);
      await exec.exec(`${newCompilerPath} bug_suit.jai - ${filePath}`, [], options);
    }
  }

  // Just print for debug purposes
  if (newIssueNumbers.length > 0) {
    try {
      const data = fs.readFileSync('test_results.json', 'utf8');
      newTestResults = JSON.parse(data);
    } catch (err) {
      console.log('Error reading file:', err);
    }
  }
  console.log('newTestResults', JSON.stringify(newTestResults, null, 2));
};



const updateGithubIssuesAndFiles = async ({
  github,
  context,
  exec,
}) => {
  const fs = require('fs');
  const {
    getCurrentJaiVersion,
    jaiVersionRegex,
    jaiVersionComparator,
    isDeepEqual,
    deepMerge,
  } = require('./_utils.js');

  const currentJaiVersion = await getCurrentJaiVersion({ exec });

  let activePlatforms = []; // all platforms where we have found a test_results.json for
  
  let allTestResults = {};
  const supportedPlatforms = ['windows', 'linux', 'mac']; // :platformSpecific
  for (const platform of supportedPlatforms) {
    try {
      const data = fs.readFileSync(`${platform}/test_results.json`, 'utf8');
      const platformTestResults = JSON.parse(data);
      // console.log(`${platform}TestResults`, JSON.stringify(platformTestResults, null, 2));
      allTestResults = deepMerge(allTestResults, platformTestResults);
      activePlatforms.push(platform);
    } catch (err) {
      console.log(`No results found for platform '${platform}'`);
    }
  }
  if (activePlatforms.length === 0) {
    throw new Error('No test results found for any platform. This could happen when all runners are offline, as we skip unavailable ones instead of crashing the whole process.');
  }
  console.log('activePlatforms', activePlatforms);
  console.log('allTestResults', JSON.stringify(allTestResults, null, 2));



  //
  // Find all new, changed and removed tests
  //

  // Load old test results
  let oldTestResults = {};
  try {
    const data = fs.readFileSync('old_test_results.json', 'utf8');
    oldTestResults = JSON.parse(data);
  } catch (err) {
    console.log('Error reading file:', err);
  }


  // Get Issue numbers
  const oldTestIssueNumbers = Object.keys(oldTestResults);
  const newTestIssueNumbers = Object.keys(allTestResults);

  // Find all tests that were added.
  const newIssueNumbers = newTestIssueNumbers.filter(
    (item) => !oldTestIssueNumbers.includes(item),
  );

  // Make sure that all new tests have a result for the current version on all active platforms
  for (const issueNumber of newIssueNumbers) {
    // It is garanteed that we at least have one result from the current machine on this version
    // @copyPasta
    let newResultsForCurrentVersion = allTestResults[issueNumber][currentJaiVersion];
    if (!newResultsForCurrentVersion) {
      console.log('No results found for:', issueNumber, currentJaiVersion);
      throw new Error(
        'No results found. This should never happen. Most likely something bad happened, or the runner this is running on was not part of the suit runners anymore! In the latter case, this runner could be out of date - or the only one with a newer version.',
      );
    }

    // Enforce that all active platforms have a result for this version
    // No matter if this runner is on a newer or older version. If at least one platform
    // would be missing in the result set, which would get detected here.
    for (const platform of activePlatforms) {
      if (!newResultsForCurrentVersion[platform]) {
        console.log('No results found for:', issueNumber, currentJaiVersion, platform);
        throw new Error(
          'No results found. This should never happen. Most likely not all runners have been updated to the latest version!',
        );
      }
    }
  }
  console.log('newIssueNumbers', JSON.stringify(newIssueNumbers, null, 2));



  // Find all tests that were removed
  const removedIssueNumbers = oldTestIssueNumbers.filter(
    (item) => !newTestIssueNumbers.includes(item),
  );
  console.log('removedIssueNumbers', JSON.stringify(removedIssueNumbers, null, 2));



  // All issues that existed both in old and new test results
  const commonIssueNumbers = oldTestIssueNumbers.filter((item) =>
    newTestIssueNumbers.includes(item),
  );
  console.log('commonIssueNumbers', JSON.stringify(commonIssueNumbers, null, 2));



  // Find all changed tests
  const changedIssueNumbers = commonIssueNumbers.filter((issueNumber) => {
    // Only compare latest version
    let oldResultsForCurrentVersion = oldTestResults[issueNumber][currentJaiVersion];
    oldResultsForCurrentVersion ||= {}; // This could happen when a new compiler version was added

    // It is garanteed that we at least have one result from the current machine on this version
    // @copyPasta
    let newResultsForCurrentVersion = allTestResults[issueNumber][currentJaiVersion];
    if (!newResultsForCurrentVersion) {
      console.log('No results found for:', issueNumber, currentJaiVersion);
      throw new Error(
        'No results found. This should never happen. Most likely something bad happened, or the runner this is running on was not part of the suit runners anymore! In the latter case, this runner could be out of date - or the only one with a newer version.',
      );
    }

    // Enforce that all active platforms have a result for this version
    // No matter if this runner is on a newer or older one. At least one platform
    // would be missing in the result set, which would get detected here.
    for (const platform of activePlatforms) {
      if (!newResultsForCurrentVersion[platform]) {
        console.log('No results found for:', issueNumber, currentJaiVersion, platform);
        throw new Error(
          'No results found. This should never happen. Most likely not all runners have been updated to the latest version!',
        );
      }
    }

    // Now we know, that newResultsForCurrentVersion has data for all active platforms.
    // 1) the oldResultsForCurrentVersion has a platform that is not active -> we ignore it
    // 2) theres a active platform that is not in oldResultsForCurrentVersion -> count as change
    //    -> this could happen, when we added a new platform. We have to count it as a change
    //       @todo maybe also trigger backtracking? But then this would have be detected
    //             in the runners, and not here.
    //    -> Special case when a new compiler version was added, the old data will be empty!

    let relevantResultSetsAreEqual = true;
    for (const platform of activePlatforms) { // this for loop already handles case 1)
      // Handle case 2)
      const oldResultForPlatform = oldResultsForCurrentVersion[platform];
      if (!oldResultForPlatform) {
        relevantResultSetsAreEqual = false;

        console.log(
          'change detected, because platform is missing in old results:',
          issueNumber,
          currentJaiVersion,
          platform,
        );
        break;
      }

      // Compare the results
      const newResultForPlatform = newResultsForCurrentVersion[platform]; // garanteed to exist
      if (!isDeepEqual(oldResultForPlatform, newResultForPlatform)) {
        console.log(
          'change detected, because results are different:',
          issueNumber,
          currentJaiVersion,
          platform,
        );
        console.log('oldResultForPlatform', JSON.stringify(oldResultForPlatform, null, 2));
        console.log('newResultForPlatform', JSON.stringify(newResultForPlatform, null, 2));
        relevantResultSetsAreEqual = false;
        break;
      }
    }

    return !relevantResultSetsAreEqual; // Has changed!
  });

  console.log('changedIssueNumbers', JSON.stringify(changedIssueNumbers, null, 2));



  // Update all new and changed tests. All unchanged tests are already up to date
  for (const issueNumber of [...newIssueNumbers, ...changedIssueNumbers]) {
    console.log('handle newOrChangedIssue', issueNumber);

    let issue = null;
    try {
      // Get Issue and Labels
      const { data: issueData } = await github.rest.issues.get({
        ...context.repo,
        issue_number: issueNumber,
      });
      issue = issueData;
    } catch (error) {
      if (error.status === 404) {
        console.log(
          `Issue not found for '${issueNumber}'. The issue was most likely deleted, but the test still exists. This should never happen. Skipping update.`,
        );
        continue;
      } else if (error.status === 410) {
        console.log(`Issue was deleted for '${issueNumber}'. Skipping update.`);
        continue;
      } else {
        throw error;
      }
    }
    if (!issue) { // Kinda useless? xD
      throw new Error('Issue not found, should never happen as we should have catched it already.');
    }

    // Replace line endings
    let newIssueBody = issue.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const existingLabels = issue.labels.map((label) => label.name);


    // Migrate issue body to latest version
    newIssueBody = migrateIssueHistory(newIssueBody);

    // Parse Issue Body
    let fullHistoryDataByVersion = [...newIssueBody.matchAll(parseIssueHistoryRegex)]
                                      .map((match) => match.groups)
                                      .reduce((acc, item) => {
                                        // Happens for the first time adding data to issue
                                        if (item.version !== '-') {
                                          acc[item.version] = item;
                                        }
                                        return acc;
                                      }, {});

    console.log('fullHistoryDataByVersion', issueNumber, JSON.stringify(fullHistoryDataByVersion, null, 2));

    const allTestResultPerVersionsSorted = Object.keys(allTestResults[issueNumber])
      .filter((v) => jaiVersionRegex.test(v)) // filter out file_path, issue_number etc
      .sort((a, b) => -jaiVersionComparator(a, b)); // sort descending

    console.log('allTestResultVersions', issueNumber, JSON.stringify(allTestResultPerVersionsSorted, null, 2));



    // Update History in Table
    // @todo add history compression and decompression
    for (const version of allTestResultPerVersionsSorted) { // We only iterate over versions that have results for
      let row = fullHistoryDataByVersion[version];
      if (!row) {
        // insert new row
        fullHistoryDataByVersion[version] = {};
        row = fullHistoryDataByVersion[version];

        getGroupNames(parseIssueHistoryRegex).forEach((groupName) => {
          if (groupName === 'version') { // Special case for version :historyColumns
            row[groupName] = version;

          } else if (activePlatforms.includes(groupName)) {
            // We know we have results for the platform!
            const testResult = allTestResults[issueNumber][version][groupName];
            if (!testResult) {
              console.log(
                'Error',
                JSON.stringify(allTestResults[issueNumber][version], null, 2),
                issueNumber,
                version,
                groupName,
              );
              throw new Error('Should never happen, as it should have been validated before!');
            }

            const errorCode = testResult.is_runtime_test
              ? testResult.run_exit_code
              : testResult.compilation_exit_code;

            row[groupName] = testResult.passed_test
              ? `✅ - ExitCode ${errorCode}`
              : `❌ - ExitCode ${errorCode}`;

          } else if (supportedPlatforms.includes(groupName)) {
            // We dont have any result for this platform. Maybe it was inactive
            row[groupName] = '-';

          } else {
            console.log('groupName', groupName);
            console.log('activePlatforms', activePlatforms);
            console.log('supportedPlatforms', supportedPlatforms);
            throw new Error('Should never happen if all places where updated correctly! :historyColumns');
          }
        });

      } else {
        // update row
        for (const platformColumn of activePlatforms) {
          let platformResult = row[platformColumn];
          if (!platformResult) {
            // added a new platform, but old results are not updated
            throw new Error('Should never happen, since we migrated the issue body');
          }

          // update missing values and always overwrite current versions results
          if (row[platformColumn] === '-' || row.version === currentJaiVersion) {
            const testResult = allTestResults[issueNumber][version][platformColumn];
            if (!testResult) {
              console.log(
                'Error',
                JSON.stringify(allTestResults[issueNumber][version], null, 2),
                issueNumber,
                version,
                platformColumn,
              );
              throw new Error('Should never happen!');
            }

            const errorCode = testResult.is_runtime_test
              ? testResult.run_exit_code
              : testResult.compilation_exit_code;

            row[platformColumn] = testResult.passed_test
              ? `✅ - ExitCode ${errorCode}`
              : `❌ - ExitCode ${errorCode}`;
          }

          // Otherwise do not update old history
        }
      }
    }


    console.log('fullHistoryDataByVersion after edit', issueNumber, JSON.stringify(fullHistoryDataByVersion, null, 2));

    const sortedHistoryData = Object.keys(fullHistoryDataByVersion)
      .map((k) => fullHistoryDataByVersion[k])
      .sort((a, b) => -jaiVersionComparator(a.version, b.version)); // sort descending

    console.log('sortedHistoryData', issueNumber, JSON.stringify(sortedHistoryData, null, 2));

    const brokenVersions = [];
    const brokenPlatformsForCurrentVersion = [];



    // Update History Table in Issue Body
    let replaceIndex = -1;
    newIssueBody = newIssueBody.replace(parseIssueHistoryRegex, (match) => {
      replaceIndex += 1;
      if (replaceIndex === 0) {
        // replace the first row with all data to replace the whole list
        let output = '';
        sortedHistoryData.forEach((row) => { // its already ordered!
          for (const column of Object.keys(row)) { // this data was ordered by regex matcher
            // Keep track of all broken versions and platforms to add the labels later on
            if (column !== 'version') {
              // :historyColumns
              if (row[column].includes('❌')) {
                // Github has a limit of 100 labels (unconfirmed)? Lets jut limit them!
                // As we iterate descendingly it will always include the latest
                // 50 broken versions
                if (brokenVersions.length < 50) {
                  brokenVersions.push(row.version);
                }

                if (row.version === currentJaiVersion) {
                  brokenPlatformsForCurrentVersion.push(column);
                }
              }
            }

            // Add column
            output += `| ${row[column]} `;
          }
          output += '|\n';
        });
        return output;
      } else {
        return ''; // delete all other rows
      }
    });


    console.log('newIssueBody', issueNumber, replaceIndex, newIssueBody);
    if (replaceIndex === -1) {
      throw new Error(
        'ERROR nothing was replaced in the issue history. This most likely happened because the regex was modified and does match the issue template.',
      );
    }




    // Update Header of Issue Body
    replaceIndex = -1;
    newIssueBody = newIssueBody.replace(parseIssueHeaderRegex, (match, ...args) => {
      replaceIndex += 1;
      const row = args.pop(); // grep the groups object
      const columnNames = Object.keys(row);
      console.log('updating header', issueNumber, match);

      let output = '';
      for (const column of columnNames) {
        let value = row[column];
        if (column === 'latestBrokenPlatforms') {
          const latestBrokenVersion = brokenVersions.sort((a, b) => -jaiVersionComparator(a, b))[0] || '-';
          if (latestBrokenVersion === '-') {
            value = '-';
          } else {
            const brokenPlatformsForLatestBrokenVersion = Object.keys(
              fullHistoryDataByVersion[latestBrokenVersion] || {},
            ).filter((k) => 
              k !== 'version' &&
              fullHistoryDataByVersion[latestBrokenVersion][k].includes('❌')
            );

            value = brokenPlatformsForLatestBrokenVersion.join(', ') || '-';
          }
        } else if (column === 'latestBrokenVersion') {
          value = brokenVersions.sort((a, b) => -jaiVersionComparator(a, b))[0] || '-';
        } else if (column === 'fixVersion') {
          if (brokenPlatformsForCurrentVersion.length > 0) {
            // we have broken platforms
            value = '-';
          } else if (value === '-') {
            // we just fixed it
            value = currentJaiVersion;
          } // else leave it as it is
        } else if (column === 'reportedVersion') {
          if (row.reportedVersion === '-') {
            value = currentJaiVersion;
          }
        }
        output += `| ${value} `;
      }
      output += '|';
      console.log('new header', issueNumber, output);
      return output;
    });
    if (replaceIndex === -1) {
      throw new Error(
        'ERROR nothing was replaced in the issue header. This most likely happened because the regex was modified and does match the issue template.',
      );
    }


    // Update the Latest Test Outputs
    let latestTestOutputs = '';
    for (const platform of activePlatforms) {
      const testResult = allTestResults[issueNumber][currentJaiVersion][platform];
      if (testResult.compiler_output
          || testResult.compiler_error_output
          || testResult.runtime_output
          || testResult.runtime_error_output
        ) {

        latestTestOutputs += `<details>\n<summary>${platform}</summary>\n`;

        if (testResult.compiler_output) {
          latestTestOutputs += `<details>\n<summary>Compiler Output</summary>\n\n\`\`\`\n`;
          latestTestOutputs += testResult.compiler_output.replace(/\r\n/g, '\n').replace(/\r/g, '\n');;
          latestTestOutputs += "\n\`\`\`\n</details>\n";
        }
        if (testResult.compiler_error_output) {
          latestTestOutputs += `<details>\n<summary>Compiler Error Output</summary>\n\n\`\`\`\n`;
          latestTestOutputs += testResult.compiler_error_output.replace(/\r\n/g, '\n').replace(/\r/g, '\n');;
          latestTestOutputs += "\n\`\`\`\n</details>\n";
        }
        if (testResult.runtime_output) {
          latestTestOutputs += `<details>\n<summary>Runtime Output</summary>\n\n\`\`\`\n`;
          latestTestOutputs += testResult.runtime_output.replace(/\r\n/g, '\n').replace(/\r/g, '\n');;
          latestTestOutputs += "\n\`\`\`\n</details>\n";
        }
        if (testResult.runtime_error_output) {
          latestTestOutputs += `<details>\n<summary>Runtime Error Output</summary>\n\n\`\`\`\n`;
          latestTestOutputs += testResult.runtime_error_output.replace(/\r\n/g, '\n').replace(/\r/g, '\n');;
          latestTestOutputs += "\n\`\`\`\n</details>\n";
        }

        latestTestOutputs += "</details>\n";
      }
    }
    if (!latestTestOutputs) {
      latestTestOutputs = 'No test outputs available';
    }
    newIssueBody = newIssueBody.replace(/### Latest Test Outputs\n---\n[\s\S]+?\n---/, `### Latest Test Outputs\n---\n${latestTestOutputs}\n---`);



    // Update Labels
    const historyColumns = getGroupNames(parseIssueHistoryRegex);

    const existingLabelsWithoutPlatformsAndBrokenVersions = existingLabels
      .filter((l) => historyColumns.includes(l) === false) // remove platforms labels
      .filter((l) => jaiVersionRegex.test(l) === false);   // remove versions labels

    const updatedUniqueLabels = [
      ...new Set([
        ...existingLabelsWithoutPlatformsAndBrokenVersions,
        ...brokenVersions,
        ...brokenPlatformsForCurrentVersion,
      ]),
    ];

    console.log('updatedUniqueLabels', issueNumber, JSON.stringify(updatedUniqueLabels, null, 2));



    // Update issue
    try {
      await github.rest.issues.update({
        ...context.repo,
        issue_number: issueNumber,
        body: newIssueBody,
        state: updatedUniqueLabels.includes(currentJaiVersion) ? 'open' : 'closed',
        labels: updatedUniqueLabels,
      });
      console.log('Updated Issue for newly added or changed test', issueNumber);
    } catch (error) {
      if (error.status === 404) {
        console.log(
          `Issue not found for '${issueNumber}'. The issue was most likely deleted, but the test still exists. This should never happen. Skipping update`,
        );
        continue;
      } else {
        throw error;
      }
    }
  }



  // Handle all removed tests
  for (const issueNumber of removedIssueNumbers) {
    try {
      // Add label to issue
      const newLabel = 'removed-test';
      const { data: issue } = await github.rest.issues.get({
        ...context.repo,
        issue_number: issueNumber,
      });
      const existingLabels = issue.labels.map((label) => label.name);
      const updatedUniqueLabels = [...new Set([...existingLabels, newLabel])];
      

      // Close issue.
      await github.rest.issues.update({
        ...context.repo,
        issue_number: issueNumber,
        state: 'closed',
        labels: updatedUniqueLabels,
      });
      console.log('Closed Issue for removed test', issueNumber);
    } catch (error) {
      if (error.status === 404 || error.status === 410) {
        console.log(`Issue not found for '${issueNumber}'. The issue was most likely deleted.`);
        continue;
      } else {
        throw error;
      }
    }
  }



  // Update test_results.json
  const { data: oldData } = await github.rest.repos
    .getContent({ ...context.repo, path: 'old_test_results.json' })
    .catch(() => ({ data: null }));

  const newTestResultsString = JSON.stringify(allTestResults, null, 2);
  const oldTestResultsString = oldData ? Buffer.from(oldData.content, 'base64').toString() : '';

  // Commit new test_results.json if it has changed
  if (newTestResultsString !== oldTestResultsString) {
    await github.rest.repos.createOrUpdateFileContents({
      ...context.repo,
      path: 'old_test_results.json',
      message: '[CI] Update test results',
      content: Buffer.from(newTestResultsString).toString('base64'),
      branch: 'master',
      ...(oldData ? { sha: oldData.sha } : {})
    });
  } else {
    console.log('No changes in test results. Skipping commit.');
  }
};

module.exports = {
  runTestSuitAndGatherOutput,
  updateGithubIssuesAndFiles,
};
