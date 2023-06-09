import {readFile, writeFile} from 'node:fs/promises';
import * as path from 'path';
import {Theme} from './models/theme';
import StyleDictionary = require('style-dictionary');
import {coreTokensConfig, themesConfig} from './config';
import {Token} from './models/token';
import {capitalCase} from 'capital-case';
import {Config} from 'style-dictionary';
import {
  androidThemeAttrsFormatter,
  androidThemeFormatter,
  androidTypographyFormatter,
} from './formatters/android_formatters';
import {
  iOSBaseColorsFormatter,
  iOSThemeColorsFormatter,
  iOSThemeColorsProtocolFormatter,
  iOSThemeFormatter,
  iOSThemeProtocolFormatter,
} from './formatters/ios_formatters';
import {registerTransforms} from '@tokens-studio/sd-transforms';
import {getInput} from '@actions/core';
import {transformTypographyForXml} from './transformers/android_xml_tyopgraphy';

run().catch(error => console.log('Failed to run weaver: ', error));

async function run() {
  // Get input and output path
  const inputPath = path.join(
    process.env.GITHUB_WORKSPACE as string,
    getInput('tokens_path', {required: true})
  );
  const outputPath = path.join(
    process.env.GITHUB_WORKSPACE as string,
    getInput('output_path', {required: true})
  );
  const projectName = capitalCase(getInput('project_name') ?? 'App');
  const version: string | undefined = getInput('version') ?? undefined;

  await configStyleDictionary(projectName, version);

  const themes = await readThemes(inputPath);

  await Promise.all([
    generateCoreTokens(inputPath, outputPath, projectName, themes),
    generateThemes(inputPath, outputPath, projectName, themes),
  ]);
}

async function readThemes(inputPath: string): Promise<Theme[]> {
  let themes: Theme[];
  if (inputPath.endsWith('.json')) {
    const inputContent = await readFile(inputPath, {
      encoding: 'utf-8',
      flag: 'r',
    });
    themes = JSON.parse(inputContent)['$themes'];
  } else {
    const themesFileContent = await readFile(`${inputPath}/$themes.json`, {
      encoding: 'utf-8',
      flag: 'r',
    });
    themes = JSON.parse(themesFileContent);
  }
  return themes;
}

async function generateCoreTokens(
  inputPath: string,
  outputPath: string,
  projectName: string,
  themes: Theme[]
) {
  // Combine all theme tokens to create a single theme token file
  const themeTokens = <Token>{};
  for (const theme of themes) {
    const themeContent = await readFile(
      `${inputPath}/theme/${theme.name}.json`,
      {
        encoding: 'utf-8',
        flag: 'r',
      }
    );
    const themeJson = JSON.parse(themeContent);
    for (const key in themeJson) {
      if (!themeTokens[key]) themeTokens[key] = themeJson[key];
    }
  }

  // Write temp file with unified theme tokens to use it for Style Dictionary
  await writeFile(
    `${inputPath}/theme_tokens.json`,
    JSON.stringify(themeTokens)
  );

  runStyleDictionary(
    coreTokensConfig(
      [`${inputPath}/theme_tokens.json`, `${inputPath}/core.json`],
      `${outputPath}/core`,
      projectName
    )
  );
}

async function generateThemes(
  inputPath: string,
  outputPath: string,
  projectName: string,
  themes: Theme[]
) {
  for (const theme of themes) {
    runStyleDictionary(
      themesConfig(
        [`${inputPath}/theme/${theme.name}.json`, `${inputPath}/core.json`],
        `${outputPath}/${theme.name}`,
        theme.name,
        projectName
      )
    );
  }
}

function runStyleDictionary(config: Config) {
  StyleDictionary.extend(config).buildAllPlatforms();
}

async function configStyleDictionary(
  projectName: string,
  version: string | undefined
) {
  // Formats
  StyleDictionary.registerFormat({
    name: 'android/text_appearance',
    formatter: args => androidTypographyFormatter(args),
  })
    .registerFormat({
      name: 'android/attrs',
      formatter: args => androidThemeAttrsFormatter(args),
    })
    .registerFormat({
      name: 'android/theme',
      formatter: args => androidThemeFormatter(args),
    })
    .registerFormat({
      name: 'ios/base_colors',
      formatter: args => iOSBaseColorsFormatter(args),
    })
    .registerFormat({
      name: 'ios/theme_colors_protocol',
      formatter: args => iOSThemeColorsProtocolFormatter(args),
    })
    .registerFormat({
      name: 'ios/theme_protocol',
      formatter: args => iOSThemeProtocolFormatter(args),
    })
    .registerFormat({
      name: 'ios/theme_colors',
      formatter: args => iOSThemeColorsFormatter(args),
    })
    .registerFormat({
      name: 'ios/theme',
      formatter: args => iOSThemeFormatter(args),
    });

  // Transforms
  await registerTransforms(StyleDictionary);

  StyleDictionary.registerTransform({
    name: 'weaver/typography/xml',
    type: 'value',
    transitive: true,
    matcher: token => token.type === 'typography',
    transformer: token => transformTypographyForXml(token.value),
  });

  // File Headers
  StyleDictionary.registerFileHeader({
    name: 'weaverFileHeader',
    fileHeader: () => weaverFileHeader(version),
  });
}

function weaverFileHeader(version: string | undefined): string[] {
  const header = ['Generated file', 'Do not edit directly'];
  if (version !== undefined) {
    header.push(`Version: ${version}`);
  }
  return header;
}
