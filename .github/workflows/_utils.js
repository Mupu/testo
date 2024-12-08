// :versionChange
const jaiVersionRegex = /(beta.)(\d+).(\d+).(\d+)/;

const getCurrentJaiVersion = async ({ exec }) => {
  let jaiVersionOutput = '';

  const options = {};
  options.silent = true;
  options.ignoreReturnCode = true;
  options.listeners = {
    stdout: (data) => {
      jaiVersionOutput += data.toString();
    },
    stderr: (data) => {
      jaiVersionOutput += data.toString();
    },
    stdline: (string) => {
      jaiVersionOutput += string;
    },
    errline: (string) => {
      jaiVersionOutput += string;
    },
  };

  // currently there is a bug in jai so we need the workaround script
  await exec.exec('jai jai_version_workaround.jai', [], options);

  const versionMatch = jaiVersionOutput.match(/beta.\d+\.\d+\.\d+/);
  const version = versionMatch
    ? versionMatch[0].replace(/\s+/g, '-')
    : 'VersionNotFound';

  // Check if the version is in the correct format
  // :versionChange
  if (jaiVersionRegex.test(version) === false) {
    throw new Error(
      'The version format has changed! Please update all places that break, like the IssueTrackers histories sorting with mixed version formats of the old and new one. :versionChange',
      version,
    );
  }

  return version;
};

const jaiVersionComparator = (version1, version2) => {
  const version1Match = version1.match(jaiVersionRegex);
  const version2Match = version2.match(jaiVersionRegex);
  if (version1Match[2] !== version2Match[2])
    return version1Match[2] - version2Match[2];
  if (version1Match[3] !== version2Match[3])
    return version1Match[3] - version2Match[3];
  return version1Match[4] - version2Match[4];
};

const decrementVersionString = (version, count = 1) => {
  const versionSplit = version.match(jaiVersionRegex);

  let newMicro = parseInt(versionSplit[4]);
  let newMinor = parseInt(versionSplit[3]);
  let newMajor = parseInt(versionSplit[2]);
  for (let i = 0; i < count; i++) {
    // Decrement version
    let carry = 0;
    newMicro = newMicro - 1;
    if (newMicro < 0) {
      carry = 1;
      newMicro = 0;
    }
    newMinor = newMinor - carry;
    if (newMinor < 0) {
      carry = 1;
      newMinor = 0;
    }
    newMajor = newMajor - carry;
    if (newMajor < 0) {
      newMajor = 0;
    }
  }

  return `${versionSplit[1]}${newMajor}.${newMinor}.${newMicro
    .toString()
    .padStart(3, '0')}`;
};

// format a string that replaces '{xxx}' with object properties of name 'xxx'
//
// Example:
//
// const template = 'Hello, {name}! Welcome to {place}.';
// const params = {
//   name: 'Alice',
//   place: 'Wonderland'
// };
//
// const result = format(template, params);
// console.log(result); // Outputs: "Hello, Alice! Welcome to Wonderland."
function format(template, params) {
  return template.replace(/\{(.*?)}/g, (match, p1) => params[p1.trim()] || '');
}

// Lets you comment out parts of a regex pattern by using `#` as a comment character
// Example:
//
// const input = 'foo bar baz';
// const pattern = makeExtendedRegExp(String.raw`
//   ^       # match the beginning of the line
//   (FOO)   # 1st capture group: match one or more word characters
//   \s      # match a whitespace character
//   (\w+)   # 2nd capture group: match one or more word characters
// `, 'i);
// console.log(input.replace(pattern, '$2 $1')); // returns "bar foo baz"

function makeExtendedRegExp(inputPatternStr, flags) {
  // Remove the first unescaped `#`, any preceeding unescaped spaces, and everything that follows
  // and then remove leading and trailing whitespace on each line, including linebreaks
  const cleanedPatternStr = inputPatternStr
    .replace(/(^|[^\\]) *#.*/g, '$1')
    .replace(/^\s+|\s+$|\n/gm, '');
  console.log('/' + cleanedPatternStr + '/' + flags);
  return new RegExp(cleanedPatternStr, flags);
}

const isDeepEqual = (object1, object2) => {
  const isObject = (object) => {
    return object != null && typeof object === 'object';
  };

  const objKeys1 = Object.keys(object1);
  const objKeys2 = Object.keys(object2);

  if (objKeys1.length !== objKeys2.length) return false;

  for (var key of objKeys1) {
    const value1 = object1[key];
    const value2 = object2[key];

    const isObjects = isObject(value1) && isObject(value2);

    if (
      (isObjects && !isDeepEqual(value1, value2)) ||
      (!isObjects && value1 !== value2)
    ) {
      return false;
    }
  }
  return true;
};

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] instanceof Object && key in target) {
      Object.assign(source[key], deepMerge(target[key], source[key]));
    }
  }
  return { ...target, ...source };
}

module.exports = {
  getCurrentJaiVersion,
  jaiVersionRegex,
  jaiVersionComparator,
  makeExtendedRegExp,
  format,
  isDeepEqual,
  deepMerge,
  decrementVersionString,
};
