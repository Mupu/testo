# Table of Contents
1. [Jai Community Bug Tracker](#jai-community-bug-tracker)
2. [THIS IS JUST THE DEV REPO THE REAL ONE IS HERE](#this-is-just-the-dev-repo-the-real-one-is-here)
3. [Contributions](#contributions)
  1. [Security](#security)
  2. [Report a Bug in regard to security](#report-a-bug-in-regard-to-security)
  3. [Report a Bug in the CI (not a Jai compiler bug)](#report-a-bug-in-the-ci-not-a-jai-compiler-bug)
  4. [Report Small Bug (Single File)](#report-small-bug-single-file)
  5. [Report Big Bug (Multiple Files)](#report-big-bug-multiple-files)
4. [Make your own Bug Tracker](#make-your-own-bug-tracker)
5. [License](#license)

# Jai Community Bug Tracker
This project started as just a small tool, was made to keep track of all the compiler bugs I found. Since a few people liked the idea of it, I started making this project - a completely automated testing suit. It is simple and fast to add new bugs, as 99% of bugs are small crashes you can strip down to a single file or even a few lines of code. This tracker will keep track of all bugs across all new versions and platforms (windows 10, linux-ubuntu-22, mac (comming soon)), and notify you when they get fixed - or even when they break again. 

# THIS IS JUST THE DEV REPO THE REAL ONE IS [HERE](https://github.com/Mupu/JaiCommunityBugTracker/)

# Contributions
## Security
As of now, we are not allowed to share the compiler itself. I had asked Jon if it's fine to 'share' it with Microsoft runners, but did not exactly get a straight answer. For that reason, I'm using my own self-hosted runners. Sadly, this, and the very nature of Jai's compile-time capabilities, represent a great threat. As I don't want to leak the compiler and even less, want to get my runners compromised, I tried to be as thorough as possible with security checks.

Since security is a tricky topic and VERY simple to get wrong or to overlook things, I'd highly appreciate you looking over the automation and giving feedback. This would mainly invole [workflow 1](.github/workflows/1_SB_issue_to_PR_synchronizer.yml) and [workflow 2](.github/workflows/2_validate_PR_and_merge.yml), as [workflow 3](.github/workflows/3_run_test_suit_and_update.yml) runs on push on master which is expected to be safe. [Workflow 1](.github/workflows/1_SB_issue_to_PR_synchronizer.yml) converts issues to PRs and keeps them up to date. I don't think there is much to do wrong, but you never know. The most important one to get right is [workflow 2](.github/workflows/2_validate_PR_and_merge.yml). If only want to audit one, do that one.

## Suggestions
If you have any suggestions for improvements or ideas for missing bug categories, tell me by using the []() template.

## Report a Bug in regard to security
If you find any bug or have something you're concerned about in regard to possible security implications, please the [Security Issue](https://github.com/Mupu/JaiCommunityBugTrackerDev/issues/new?assignees=&labels=security&projects=&template=security_issue_template.yml&title=%5BSECURITY%5D+) template. Make sure to [link the important code section](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-a-permanent-link-to-a-code-snippet) via githubs permalinks. I will respond as fast as possible to resolve all secuirty problems.

## Report a Bug in the CI (not a Jai compiler bug)
When you happen to find any other bug thats not related to Jai nor security, please use the [CI Issue](https://github.com/Mupu/JaiCommunityBugTrackerDev/issues/new?assignees=&labels=bug&projects=&template=ci_issue_template.yml&title=%5BBUG%5D+) template. Ofcourse, you can also create a PR fixing the issues instead!

## Report Small Bug (Single File)
If you want to report a bug that fits into a single file, the right place is to use the [Bug Report - Single File (Automated PR)](https://github.com/Mupu/JaiCommunityBugTrackerDev/issues/new?assignees=&labels=SB&projects=&template=sb_issue_template.yml&title=%5BSB%5D+Bug+Report+-+Single+File+%28DO+NOT+EDIT+TITLE%29) template. This pipeline is fully automated. It should be self-explanatory. If you have any suggestions for new bug categories, let me know, and I'll add them to the list.

## Report Big Bug (Multiple Files)
*No automation yet!* - Just open a normal PR. The only 2 rules are: 
1) All files have to be in ONE folder named `0_0_[RC]EC<errorcode>`, where `R` and `C` corresponds to runtime or compile time test, and `<errorcode>` to the expected error code to pass the test.
2) That folder must contain a first.jai

# Make your own Bug Tracker
If you want to make your own version of this, or use it for general testing and what not - you can do so! The main things to adjust are:
1) main/master branch names
2) @Mupu pings
3) Have self-hosted runners and if needed adjust runs-on labels
4) Create your own Bot or Access token to give to the workflows. This is needed to have workflows trigger other workflows.explanatory.

# License
This project is licensed under the MIT License. See [LICENSE.md](LICENSE.md)
