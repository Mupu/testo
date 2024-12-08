# Jai Community Bug Tracker
This project started as just a small tool, was made to keep track of all the compiler bugs I found. Since a few people liked the idea of it, I started making this project - a completely automated testing suit. It is simple and fast to add new bugs, as 99% of bugs are small crashes you can strip down to a single file or even a few lines of code. This tracker will keep track of all bugs across all new versions and platforms (windows 10, linux-ubuntu-22, mac (comming soon)), and notify you when they get fixed - or even when they break again. 

# THIS IS JUST THE DEV REPO THE REAL ONE IS [HERE](https://github.com/Mupu/JaiCommunityBugTracker/)

# Contributions
## Security
As of now, we are not allowed to share the compiler itself. I had asked Jon if it's fine to 'share' it with Microsoft runners, but did not exactly get a straight answer. For that reason, I'm using my own self-hosted runners. Sadly, this, and the very nature of Jai's compile-time capabilities, represent a great threat. As I don't want to leak the compiler and even less, want to get my runners compromised, I tried to be as thorough as possible with security checks.

Since security is a tricky topic and VERY simple to get wrong or to overlook things, I'd highly appreciate you looking over the automation and giving feedback. This would mainly invole workflow 1 and 2, as 3 runs on push on master which is expected to be safe. workflow 1 converts issues to PR and keeps them up to date. I don't think there is much to do wrong, but you never know. the most important one to get right is workflow 2. If only want to audit one, do that one.

## Report Small Bug (Single File)
If you want to report a bug that fits into a single file, the right place is to use the Bug Report - `Single File (Automated PR)` template. This pipeline is fully automated. It should be self-explanatory. If you have any suggestions for new bug categories, let me know, and I'll add them to the list.

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
This project is licensed under the MIT License. See [LICENSE.md](https://github.com/Mupu/JaiCommunityBugTrackerDev/blob/master/LICENSE.md)
