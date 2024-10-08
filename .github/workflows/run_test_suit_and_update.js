const versionRegex = /(beta.)(\d+).(\d+).(\d+)/

const decrementVersionString = (version, count = 1) => {
  const versionSplit = version.match(versionRegex);

  let newMicro = parseInt(versionSplit[4]);
  let newMinor = parseInt(versionSplit[3]);
  let newMajor = parseInt(versionSplit[2]);
  for (let i = 0; i < count; i++) {
    // Decrement version
    let carry = 0;
    newMicro = newMicro - 1;
    if (newMicro < 0) {
      carry = 1
      newMicro = 0;
    }
    newMinor = newMinor - carry;
    if (newMinor < 0) {
      carry = 1
      newMinor = 0;
    }
    newMajor = newMajor - carry;
    if (newMajor < 0) {
      newMajor = 0;
    }
  }

  return `${versionSplit[1]}${newMajor}.${newMinor}.${newMicro.toString().padStart(3, '0')}`
}

const parseIssueHeaderStatusRegex = /(?<=\| :-.*\s)\| (?<emailedIn>.*?) \| (?<lastBrokenPlatforms>.*?) \| (?<lastEncounteredVersion>.*?) \| (?<fixVersion>.*?) \|/im;
const parseIssueHistoryRegex = /(?<=History$\s(?:.*$\s){2,})\| (?<passedTest>.*?) \| (?<platforms>.*?) \| (?<date>.*?) \| (?<version>.*?) \| (?<errorCode>\d+) - Expected (?<expectedErrorCode>\d+) \|/img;

const runTestSuitAndGatherOutput = async ({ github, context, exec, io }) => {
  const path = require('path');
  const fs = require('fs');

  const testSuitOutput = {};

  // Jai Version
  const { isDeepEqual, jaiVersion: getJaiVersion } = require('./utils.js');
  const currentVersion = await getJaiVersion({ exec });
  if (versionRegex.test(currentVersion) === false) {
    console.error('The version format has changed! Please update all places that break, like the IssueTrackers histories sorting with mixed version formats of the old and new one.', currentVersion);
    process.exit(1);
  }
  let tempVersion = currentVersion

  const platform = process.env.RUNNER_OS.toLowerCase();
  console.log(`Running on platform: ${platform}`);

  // Get old state of test results
  let oldTestResults = [];
  try {
    const data = fs.readFileSync('test_results.json', 'utf8');
    oldTestResults = JSON.parse(data);
  } catch (err) {
    console.error("Error reading file:", err);
  }

  console.log('Running for version:', tempVersion);
  const options = { silent: false };
  let compilerPath = await io.which('jai'); // we start with the current one
  // This will fail on windows because we already have the real path
  try {
    compilerPath = fs.readlinkSync(compilerPath);
  } catch (err) { } // ignore error

  console.log('compilerPath', compilerPath);
  let suffix = '';
  if (platform === 'linux') suffix = '-linux';
  if (platform === 'macos') suffix = '-macos';

  const extension = path.extname(compilerPath);
  await exec.exec(`${compilerPath} bug_suit.jai`, [], options);

  tempVersion = decrementVersionString(tempVersion);
  console.log('Running for version:', tempVersion);
  compilerPath = path.resolve(compilerPath, '..', '..', '..', `jai-${tempVersion}/bin`) + `${path.sep}jai${suffix}${extension}`;
  console.log('compilerPath', compilerPath);
  await exec.exec(`${compilerPath} bug_suit.jai`, [], options);

  tempVersion = decrementVersionString(tempVersion);
  console.log('Running for version:', tempVersion);
  compilerPath = path.resolve(compilerPath, '..', '..', '..', `jai-${tempVersion}/bin`) + `${path.sep}jai${suffix}${extension}`;
  await exec.exec(`${compilerPath} bug_suit.jai`, [], options);


  // Get new test results
  let newTestResultsFileContent;
  let newTestResults = [];
  try {
    newTestResultsFileContent = fs.readFileSync('temp_test_results.json', 'utf8');
    newTestResults = JSON.parse(newTestResultsFileContent);
  } catch (err) {
    console.error("Error reading file:", err);
    newTestResultsFileContent = undefined;
  }
  console.log('newTestResults', JSON.stringify(newTestResults, null, 2));

  // make test results available via version, and results via name
  const oldTestResultsByVersion = oldTestResults[platform]?.reduce((acc, item) => {
    acc[item.version] = item;
    // also reduce the results
    acc[item.version].results = item.results.reduce((acc, item) => {
      acc[item.file] = item;
      return acc;
    }, {});

    return acc;
  }, {}) || [];

  const newTestResultsByVersion = newTestResults[platform]?.reduce((acc, item) => {
    acc[item.version] = item;
    // also reduce the results
    acc[item.version].results = item.results.reduce((acc, item) => {
      acc[item.file] = item;
      return acc;
    }, {});

    return acc;
  }, {}) || [];

  // console.log('new test res', newTestResults);
  // console.log('newTestResultsByVersion', newTestResultsByVersion);

  const previousVersion = decrementVersionString(currentVersion, 1);
  console.log(previousVersion);
  // console.log('old', oldTestResultsByVersion[previousVersion]);
  // console.log('new', newTestResultsByVersion[previousVersion]);


  // We need to find all tests that are new. We compare the old and new log. We have to update their issues.
  //
  //
  //           Old Log       New Log
  //              -          0.1.094
  //           0.1.093  <>   0.1.093 // This version exists in both logs, compare them
  //           0.1.092       0.1.092
  //           0.1.091          -
  // 
  const newTests = Object.values(newTestResultsByVersion[previousVersion].results).filter(obj1 =>
    !oldTestResultsByVersion[previousVersion]  // if the previous version does not exist in old log, then all tests are new
    || !Object.values(oldTestResultsByVersion[previousVersion].results).some(obj2 => obj1.file === obj2.file) // if the file does not exist in old log
  );

  console.log('newTests\n', newTests);


  // We need to update all issues where the status has changed. We compare the old and new log.
  //
  //           Old Log       New Log
  //              -          0.1.094
  //                            ^--
  //                               |- compare those to versions, to see if the updated changed the test result
  //                            v--
  //           0.1.093       0.1.093 
  //           0.1.092       0.1.092
  //           0.1.091          -
  // 
  const changedTests = Object.values(newTestResultsByVersion[currentVersion].results).filter(
    obj1 => obj1.file in newTestResultsByVersion[previousVersion].results  // if the file exists in previous version, this should be redundant?
      && !isDeepEqual(obj1, newTestResultsByVersion[previousVersion].results[obj1.file]) // if the test results are different
      && !newTests.some((test) => test.file === obj1.file) // if the test is not new
  )
  console.log('changedTests\n', changedTests);


  // We need to find all tests that are removed to close their issues.
  //
  //           Old Log       New Log
  //              -          0.1.094
  //           0.1.093  <>   0.1.093 // This version exists in both logs, compare them
  //           0.1.092       0.1.092
  //           0.1.091          -
  // 
  const removedTests = Object.values(oldTestResultsByVersion[previousVersion]?.results || []).filter(obj1 =>
    !newTestResultsByVersion[previousVersion]  // if the previous version does not exist in new log, then all tests are removed
    || !Object.values(newTestResultsByVersion[previousVersion].results).some(obj2 => obj1.file === obj2.file) // if the file does not exist in new log
  );
  console.log('removedTests\n', removedTests);


  const oldToNewCompilerVersions = newTestResults[platform].map(item => item.version).sort()
  const currentDate = new Date().toISOString().split('T')[0];


  // Handle all new Tests
  for (const currentTest of newTests) {
    console.log('newTest', currentTest);
    const issueId = Number.parseInt(currentTest.file.match(/\d+(?=[./])/)?.[0]) || -1;
    if (issueId === -1) {
      console.error('Issue ID not found in file name:', currentTest);
      continue;
    }

    // In theorie there could already exist a history from other platforms
    const { data: issue } = await github.rest.issues.get({
      ...context.repo,
      issue_number: issueId
    });
    issue.body = issue.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    let newCommentBody = issue.body;
    let newLabels = issue.labels.map(label => label.name);

    newCommentBody = newCommentBody.replace(parseIssueHeaderStatusRegex, (match, emailedIn, lastBrokenPlatforms, lastEncounteredVersion, fixVersion) => {
      lastBrokenPlatforms = platform;
      // Since its a new bug, we know the latest version is broken so we use it here
      lastEncounteredVersion = currentVersion;
      return `| ${emailedIn} | ${lastBrokenPlatforms} | ${lastEncounteredVersion} | ${fixVersion} |`;
    })

    // since its a new issue, the history should be empty, all platforms in the matrix only get the original state and it will be udpated after all of them ran
    // if (parseIssueHistoryRegex.test(newCommentBody)) {
    //   console.error('History already exists in issue:', issueId);
    //   //process.exit(1); // Should never happen
    //   continue;
    // }

    // Go over all versions of the test run and change the history accordingly
    oldToNewCompilerVersions.forEach((version, index) => {
      const currentTestResultOfVersion = newTestResultsByVersion[version].results[currentTest.file];
      const currentPassedTest = currentTestResultOfVersion.passed_test ? '✅' : '❌';
      const currentErrorCode = currentTestResultOfVersion.did_run ? currentTestResultOfVersion.run_exit_code : currentTestResultOfVersion.compilation_exit_code;
      const currentExpectedErrorCode = currentTestResultOfVersion.expected_error_code;

      if (currentTestResultOfVersion.passed_test === false) {
        newLabels.push(version, platform);
      }

      if (index === 0 && !parseIssueHistoryRegex.test(newCommentBody)) { // only if its first entry and no history exists
        // Just append since the history is still empty
        newCommentBody = newCommentBody.trimEnd() + `\n| ${currentPassedTest} | ${platform} | ${currentDate} | ${version} | ${currentErrorCode} - Expected ${currentExpectedErrorCode} |`;
      } else {
        // Update history via regex, only works if at least one is there
        let replaceIndex = 0;
        newCommentBody = newCommentBody.replace(parseIssueHistoryRegex, (match, passedTest, platforms, date, oldVersion, errorCode, expectedErrorCode) => {
          /////////////////////////////////////////////
          // Add New Row
          let newFirstRow = '';
          const testResultOfPreviousVersion = newTestResultsByVersion[oldToNewCompilerVersions[index - 1]]?.results[currentTest.file];
          // index === 0 means there is already a history, but only of other platforms, so we need to add all the results of this platform
          const addNewEntry = index === 0 || currentTestResultOfVersion.passed_test === false || (currentTestResultOfVersion.passed_test === true && testResultOfPreviousVersion.passed_test === false);
          if (replaceIndex === 0 && addNewEntry) {
            replaceIndex++; // increment counter
            newFirstRow = `| ${currentPassedTest} | ${platform} | ${currentDate} | ${version} | ${currentErrorCode} - Expected ${currentExpectedErrorCode} |\n`
          }

          /////////////////////////////////////////////
          // Overwrite Old Row
          replaceIndex++; // increment counter
          let oldRow = `| ${passedTest} | ${platforms} | ${date} | ${oldVersion} | ${errorCode} - Expected ${expectedErrorCode} |`
          return `${newFirstRow}${oldRow}`;
        })

      }
    });


    const issueEntry = {};
    issueEntry.issueId = issueId;
    issueEntry.newLabels = [...new Set(newLabels)]; // remove duplicates
    issueEntry.newCommentBody = newCommentBody;
    testSuitOutput.issues ||= [];
    testSuitOutput.issues.push(issueEntry);
    // await createLabels({github, context, labelNames: newLabels});

    // // @todo instead up update here, pass result to updater
    // // Update comment
    // await github.rest.issues.update({
    //   ...context.repo,
    //   issue_number: issueId,
    //   body: newCommentBody,
    //   labels: newLabels
    // });
  }







  // Handle all changed Tests
  for (const currentTest of changedTests) {
    const issueId = Number.parseInt(currentTest.file.match(/\d+(?=[./])/)?.[0]) || -1;
    if (issueId === -1) {
      console.error('Issue ID not found in file name:', currentTest);
      continue;
    }

    const { data: issue } = await github.rest.issues.get({
      ...context.repo,
      issue_number: issueId
    });
    issue.body = issue.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    console.log('issue', issue);

    let newCommentBody = issue.body;
    let newLabels = issue.labels.map(label => label.name);

    // Get last history entry of current platform
    const lastHistoryEntryOfPCurrentlatform = [...newCommentBody.matchAll(parseIssueHistoryRegex)]
      .map(match => match.groups) // Extract groups
      .reduce((acc, item, i) => { // Reduce to last entry per platform
        const platforms = item.platforms.split(',').map(p => p.trim()); // In case platforms are comma-separated
        platforms.forEach(platform => {
          if (!acc[platform]) {
            acc[platform] = item;
            acc[platform]['index'] = i; // Add row index for later use
          }
        });
        return acc;
      }, {})[platform];

    const testToggled = (lastHistoryEntryOfPCurrentlatform.passedTest === '❌' && currentTest.passed_test === true) || (lastHistoryEntryOfPCurrentlatform.passedTest === '✅' && currentTest.passed_test === false);

    // Update history via regex
    let replaceIndex = 0;
    newCommentBody = newCommentBody.replace(parseIssueHistoryRegex, (match, passedTest, platforms, date, oldVersion, errorCode, expectedErrorCode, i) => {
      /////////////////////////////////////////////
      // Add New Row
      let newFirstRow = '';
      // only add new entry if status changed, or if the test still failes on a newer version
      const addNewEntry = testToggled || (!testToggled 
                                          && (lastHistoryEntryOfPCurrentlatform.version !== currentVersion 
                                              || lastHistoryEntryOfPCurrentlatform.errorCode !== errorCode 
                                              || lastHistoryEntryOfPCurrentlatform.expectedErrorCode !== expectedErrorCode
                                          ) && currentTest.passed_test === false);
      if (replaceIndex === 0 && addNewEntry) {
        replaceIndex++; // Increment counter
        newFirstRow = `| ${currentTest.passed_test ? '✅' : '❌'} | ${platform} | ${currentDate} | ${currentVersion} | ${currentTest.did_run ? currentTest.run_exit_code : currentTest.compilation_exit_code} - Expected ${currentTest.expected_error_code} |\n`
      }

      /////////////////////////////////////////////
      // Overwrite Old Row
      replaceIndex++; // increment counter
      let oldRow = `| ${passedTest} | ${platforms} | ${date} | ${oldVersion} | ${errorCode} - Expected ${expectedErrorCode} |`
      return `${newFirstRow}${oldRow}`;
    })

    let newIssueState = undefined;
    // Update header status
    newCommentBody = newCommentBody.replace(parseIssueHeaderStatusRegex, (match, emailedIn, lastBrokenPlatforms, lastEncounteredVersion, fixVersion) => {
      let brokenPlatforms;
      let newEmailIn;
      if (testToggled && currentTest.passed_test) {
        // Test passed, remove platform from broken list
        brokenPlatforms = '-'; // lastBrokenPlatforms.split(', ').filter(p => p !== platform).join(', ') || '-'; // remove current platform from list
        fixVersion = currentVersion;
        newEmailIn = '✅';
        newIssueState = 'closed';
        newLabels = newLabels.filter((p) => p !== platform);
      } else if (testToggled && !currentTest.passed_test) {
        // Test failed, add platform to broken list
        brokenPlatforms = platform; // [... new Set(lastBrokenPlatforms.split(', ').filter(p => p !== '-').concat(platform))].sort().join(', '); // add current platform to list
        lastEncounteredVersion = [lastEncounteredVersion, currentVersion].sort().reverse()[0]
        fixVersion = '-'; // no fix version yet
        newEmailIn = '❌';
        newIssueState = 'open';
        newLabels.push(currentVersion, platform);
      } else {
        // Test result did not change
        brokenPlatforms = lastBrokenPlatforms;
        newEmailIn = emailedIn;
      }
      return `| ${newEmailIn} | ${brokenPlatforms} | ${lastEncounteredVersion} | ${fixVersion} |`;
    })

    const issueEntry = {};
    issueEntry.issueId = issueId;
    issueEntry.newLabels = [...new Set(newLabels)]; // remove duplicates
    issueEntry.newCommentBody = newCommentBody;
    issueEntry.newIssueState = newIssueState;
    testSuitOutput.issues ||= [];
    testSuitOutput.issues.push(issueEntry);

    // newLabels = [...new Set(newLabels)]; // remove duplicates
    // await createLabels({github, context, labelNames: newLabels});

    // // Update comment
    // await github.rest.issues.update({
    //   ...context.repo,
    //   issue_number: issueId,
    //   body: newCommentBody,
    //   ...(newIssueState ? { state: newIssueState, state_reason: newIssueState === 'open' ? 'reopened' : 'completed' } : {}),
    //   labels: newLabels
    // });
  }

  // const { data } = await github.rest.repos.getContent({...context.repo, path: 'test_results.json'}).catch(() => ({ data: null }));

  // // Commit test_results.json
  // // @todo only do it once aswell
  // await github.rest.repos.createOrUpdateFileContents({
  //   ...context.repo,
  //   path: 'test_results.json',
  //   message: '[CI] Update test results',
  //   content: Buffer.from(newTestResultsFileContent || '').toString('base64'),
  //   branch: 'master',
  //   ...(data ? { sha: data.sha } : {})
  // });

  // Don't think we need to handle removed tests
  // for (const currentTest of removedTests) {
  // }


  return testSuitOutput;
};


const updateGithubIssuesAndFiles = async ({ github, context, exec, io, testSuitOutputs }) => {
  const fs = require('fs');
  const { isDeepEqual } = require('./utils.js');
  const { createLabels } = require('./create_label.js');
  console.log('testSuitOutput', JSON.stringify(testSuitOutputs, null, 2));

  const mergedPlatformIssues = {
    // issueId: {
    //   newLabels: [],
    //   historyEntries: [
    //     {
    //        passedTest: '✅',
    //        platforms: 'windows, linux',
    //        date: '2021-09-07',
    //        version: '0.1.093',
    //        errorCode: '0',
    //        expectedErrorCode: '0'
    //     }
    //   ]
    // }
  };

  // Gather all isssue data from all platforms
  for (const platform in testSuitOutputs) {
    console.log('platform', platform);
    for (const issue of (testSuitOutputs[platform]?.issues || [])) {
      console.log('issue', issue);
      // All issues contain the updated history for each platform, we need to merge them
      // to do that, we combine them into one object and then reduce them to the last entry per platform.
      // While doing that, we also remove dublicates, and merge entries when possible
      mergedPlatformIssues[issue.issueId] ||= { newLabels: [], newIssueStates: [], historyEntries: [], newCommentBodies: [] };
      // Add all labels except those of other platforms, because they could be outdated
      mergedPlatformIssues[issue.issueId].newLabels.push(...issue.newLabels.filter(l => !Object.keys(testSuitOutputs).filter(l => l !== platform).includes(l)));
      mergedPlatformIssues[issue.issueId].newCommentBodies.push(issue.newCommentBody);
      mergedPlatformIssues[issue.issueId].newIssueStates.push(issue.newIssueState);

      [...issue.newCommentBody.matchAll(parseIssueHistoryRegex)].map(e => e.groups).forEach((g) => {
        const passedTest = g.passedTest;
        const platforms = g.platforms;
        const date = g.date;
        const version = g.version;
        const errorCode = g.errorCode;
        const expectedErrorCode = g.expectedErrorCode;

        mergedPlatformIssues[issue.issueId].historyEntries.push({ passedTest, platforms, date, version, errorCode, expectedErrorCode });
      });


      // const lastHistoryEntryOfPCurrentlatform = [...issue.newCommentBody.matchAll(parseIssueHistoryRegex)]
      //   .map(match => match.groups) // Extract groups
      //   .reduce((acc, item, i) => { // Reduce to last entry per platform
      //     const platforms = item.platforms.split(',').map(p => p.trim()); // In case platforms are comma-separated
      //     platforms.forEach(platform => {
      //       if (!acc[platform]) {
      //         acc[platform] = item;
      //         acc[platform]['index'] = i; // Add row index for later use
      //       }
      //     });
      //     return acc;
      //   }, {})[platform];

      // issue.newCommentBody = issue.newCommentBody.replace(parseIssueHeaderStatusRegex, (match, emailedIn, lastBrokenPlatforms, lastEncounteredVersion, fixVersion) => {
      //   lastBrokenPlatforms = platform;
      //   // Since its a new bug, we know the latest version is broken so we use it here
      //   lastEncounteredVersion = currentVersion;
      //   return `| ${emailedIn} | ${lastBrokenPlatforms} | ${lastEncounteredVersion} | ${fixVersion} |`;
      // })

    }
  }

  // Merge all information and update issues accordingly
  for (const issueId in mergedPlatformIssues) {
    const issue = mergedPlatformIssues[issueId];
    console.log('issue', issueId, JSON.stringify(issue, null, 2));

    // Remove duplicates from history, and merge entries when all fields except platforms are the same
    const mergedHistoryEntries = issue.historyEntries.reduce((acc, item) => {
      const existingEntry = acc.reverse().find(e => e.passedTest === item.passedTest
        // && e.date === item.date
        && e.version === item.version
        && e.errorCode === item.errorCode
        && e.expectedErrorCode === item.expectedErrorCode
        );

      console.log('existingEntry', existingEntry);

      if (existingEntry) {
        // If they are the same, skip, otherwise merge platforms
        if (existingEntry.platforms !== item.platforms) {
          // Merge platforms
          existingEntry.platforms = [...new Set(existingEntry.platforms.split(', ').concat(item.platforms.split(', ')))].filter(p => p !== '-').sort().join(', ');
        }
      } else {
        acc.push(item);
      }
      return acc;
    }, []);

    // Sort latest date first and then by version
    mergedHistoryEntries.sort((a, b) => {
      if (a.date === b.date) {
        return b.version.localeCompare(a.version);
      }
      return b.date.localeCompare(a.date);
    });

    console.log('mergedHistoryEntries', issueId, JSON.stringify(mergedHistoryEntries, null, 2));

    let newCommentBody = issue.newCommentBodies[0];
    // Remove all history entries from the body
    newCommentBody = newCommentBody.replace(/(?<=History$\s(?:.*$\s){2,})\|.*\s?/img, '');
    // Add all updated history entries
    mergedHistoryEntries.forEach((entry) => {
      newCommentBody = newCommentBody.trimEnd() + `\n| ${entry.passedTest} | ${entry.platforms} | ${entry.date} | ${entry.version} | ${entry.errorCode} - Expected ${entry.expectedErrorCode} |`;
    });

    // Get last history entry of every platform
    const lastHistoryEntryByPlatform = [...newCommentBody.matchAll(parseIssueHistoryRegex)]
      .map(match => match.groups) // Extract groups
      .reduce((acc, item, i) => { // Reduce to last entry per platform
        const platforms = item.platforms.split(',').map(p => p.trim()); // In case platforms are comma-separated
        platforms.forEach(platform => {
          if (!acc[platform]) {
            acc[platform] = item;
            acc[platform]['index'] = i; // Add row index for later use
          }
        });
        return acc;
      }, {});
    console.log('lastHistoryEntryByPlatform', lastHistoryEntryByPlatform);

    const statusHeaders = issue.newCommentBodies.reduce((acc, item) => {
      acc.push(item.match(parseIssueHeaderStatusRegex).groups);
      return acc;
    }, []).reduce((acc, item) => { // Make it SOA
      acc.emailedIn.push(item.emailedIn);
      acc.lastBrokenPlatforms.push(...item.lastBrokenPlatforms.split(', '));
      acc.lastEncounteredVersion.push(item.lastEncounteredVersion);
      acc.fixVersion.push(item.fixVersion);
      return acc;
    }, {
      emailedIn: [],
      lastBrokenPlatforms: [],
      lastEncounteredVersion: [],
      fixVersion: [],
    });
    console.log('statusHeaders', statusHeaders);

    let mergedHeaderState;
    if (issue.newIssueStates.some(v => v === 'open')) { // newly failed on any platform
      mergedHeaderState = 'open';
    } else if (issue.newIssueStates.some(v => v === 'closed') && lastHistoryEntryByPlatform.map(i => .every(v => v === '✅')) {  // newly fixed on all platforms
      mergedHeaderState = 'closed';
    } else {
      mergedHeaderState = undefined; // even if some closed, its irrelevant if not all are closed
    }
    console.log('mergedHeaderState', mergedHeaderState);

    // Update header by merging the status of all platforms
    newCommentBody = newCommentBody.replace(parseIssueHeaderStatusRegex, (match, emailedIn, lastBrokenPlatforms, lastEncounteredVersion, fixVersion) => {
      const newLastBrokenPlatforms = [...new Set(statusHeaders.lastBrokenPlatforms)].filter(p => p !== '-').sort().join(', ') || '-';
      const newLastEncounteredVersion = statusHeaders.lastEncounteredVersion.sort().reverse()[0]; // Take latest
      const newFixVersion = statusHeaders.fixVersion.some(v => v === '-') ? '-' : statusHeaders.fixVersion.filter(v => v !== '-').sort().reverse()[0];
      const newEmailedIn = mergedHeaderState === 'open' ? '❌' : mergedHeaderState === 'closed' ? '✅' : emailedIn;
      return `| ${newEmailedIn} | ${newLastBrokenPlatforms} | ${newLastEncounteredVersion} | ${newFixVersion} |`;
    });

    // Create Labels
    const uniqueLabels = [...new Set(issue.newLabels)]; // remove duplicates
    await createLabels({ github, context, labelNames: uniqueLabels });


    // Update Body
    await github.rest.issues.update({
      ...context.repo,
      issue_number: issueId,
      body: newCommentBody,
      ...(mergedHeaderState ? { state: mergedHeaderState, state_reason: mergedHeaderState === 'open' ? 'reopened' : 'completed' } : {}),
      labels: uniqueLabels
    });
  }



  // Update test_results.json
  const { data: oldData } = await github.rest.repos.getContent({ ...context.repo, path: 'test_results.json' }).catch(() => ({ data: null }));

  const windowsTestResultContent = fs.readFileSync('windows/test_results.json', 'utf8');
  const windowsTestResults = JSON.parse(windowsTestResultContent);

  const linuxTestResultContent = fs.readFileSync('linux/test_results.json', 'utf8');
  const linuxTestResults = JSON.parse(linuxTestResultContent);

  const newTestResults = {
    windows: windowsTestResults.windows,
    linux: linuxTestResults.linux
  };
  const newTestResultsContent = JSON.stringify(newTestResults, null, 2);

  if (oldData && atob(oldData.content) === newTestResultsContent) {
    console.log('No changes in test results, skipping update');
    return;
  }

  // Commit new test_results.json
  // await github.rest.repos.createOrUpdateFileContents({
  //   ...context.repo,
  //   path: 'test_results.json',
  //   message: '[CI] Update test results',
  //   content: Buffer.from(JSON.stringify(newTestResults, null, 2)).toString('base64'),
  //   branch: 'master',
  //   ...(oldData ? { sha: oldData.sha } : {})
  // });
}

module.exports = {
  runTestSuitAndGatherOutput,
  updateGithubIssuesAndFiles
}