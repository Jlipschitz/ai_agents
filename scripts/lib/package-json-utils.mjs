import fs from 'node:fs';

function findTopLevelObjectProperty(text, propertyName) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      if (depth !== 1) {
        inString = true;
        continue;
      }
      let end = index + 1;
      let key = '';
      let keyEscaped = false;
      for (; end < text.length; end += 1) {
        const keyChar = text[end];
        if (keyEscaped) {
          key += keyChar;
          keyEscaped = false;
        } else if (keyChar === '\\') {
          keyEscaped = true;
        } else if (keyChar === '"') {
          break;
        } else {
          key += keyChar;
        }
      }
      if (key !== propertyName) {
        inString = true;
        continue;
      }
      let colon = end + 1;
      while (/\s/.test(text[colon] ?? '')) colon += 1;
      if (text[colon] !== ':') {
        inString = true;
        continue;
      }
      let valueStart = colon + 1;
      while (/\s/.test(text[valueStart] ?? '')) valueStart += 1;
      if (text[valueStart] !== '{') return null;
      let valueDepth = 0;
      let valueInString = false;
      let valueEscaped = false;
      for (let valueEnd = valueStart; valueEnd < text.length; valueEnd += 1) {
        const valueChar = text[valueEnd];
        if (valueInString) {
          if (valueEscaped) valueEscaped = false;
          else if (valueChar === '\\') valueEscaped = true;
          else if (valueChar === '"') valueInString = false;
          continue;
        }
        if (valueChar === '"') valueInString = true;
        else if (valueChar === '{') valueDepth += 1;
        else if (valueChar === '}') {
          valueDepth -= 1;
          if (valueDepth === 0) return { start: index, end: valueEnd + 1 };
        }
      }
      return null;
    }
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
  }
  return null;
}

function formatScriptsProperty(scripts) {
  return `"scripts": ${JSON.stringify(scripts, null, 2).replace(/\n/g, '\n  ')}`;
}

export function writePackageScripts(packageJsonPath, scripts) {
  const current = fs.readFileSync(packageJsonPath, 'utf8');
  const property = formatScriptsProperty(scripts);
  const range = findTopLevelObjectProperty(current, 'scripts');
  if (range) {
    fs.writeFileSync(packageJsonPath, `${current.slice(0, range.start)}${property}${current.slice(range.end)}`);
    return;
  }
  const openBrace = current.indexOf('{');
  if (openBrace < 0) {
    fs.writeFileSync(packageJsonPath, `${JSON.stringify({ scripts }, null, 2)}\n`);
    return;
  }
  const afterOpen = openBrace + 1;
  const suffix = current.slice(afterOpen).replace(/^\s*/, '\n');
  fs.writeFileSync(packageJsonPath, `${current.slice(0, afterOpen)}\n  ${property},${suffix}`);
}
