import crypto from 'crypto';
import fs from 'fs-extra';
import { z } from 'zod';
import { App } from '@/server/db/schema';
import { envMapToString, envStringToMap, generateVapidKeys, getAppEnvMap } from '@/server/utils/env-generation';
import { deleteFolder, fileExists, getSeed, readdirSync, readFile, readJsonFile } from '../../common/fs.helpers';
import { APP_CATEGORIES, FIELD_TYPES } from './apps.types';
import { getConfig } from '../../core/TipiConfig';
import { Logger } from '../../core/Logger';
import { notEmpty } from '../../common/typescript.helpers';
import { ARCHITECTURES } from '../../core/TipiConfig/TipiConfig';

const formFieldSchema = z.object({
  type: z.nativeEnum(FIELD_TYPES).catch(() => FIELD_TYPES.TEXT),
  label: z.string(),
  placeholder: z.string().optional(),
  max: z.number().optional(),
  min: z.number().optional(),
  hint: z.string().optional(),
  options: z.object({ label: z.string(), value: z.string() }).array().optional(),
  required: z.boolean().optional().default(false),
  default: z.union([z.boolean(), z.string()]).optional(),
  regex: z.string().optional(),
  pattern_error: z.string().optional(),
  env_variable: z.string(),
});

export const appInfoSchema = z.object({
  id: z.string(),
  available: z.boolean(),
  port: z.number().min(1).max(65535),
  name: z.string(),
  description: z.string().optional().default(''),
  version: z.string().optional().default('latest'),
  tipi_version: z.number(),
  short_desc: z.string(),
  author: z.string(),
  source: z.string(),
  website: z.string().optional(),
  force_expose: z.boolean().optional().default(false),
  generate_vapid_keys: z.boolean().optional().default(false),
  categories: z
    .nativeEnum(APP_CATEGORIES)
    .array()
    .catch((ctx) => {
      Logger.warn(`Invalid categories "${JSON.stringify(ctx.input)}" defaulting to utilities`);
      return [APP_CATEGORIES.UTILITIES];
    }),
  url_suffix: z.string().optional(),
  form_fields: z.array(formFieldSchema).optional().default([]),
  https: z.boolean().optional().default(false),
  exposable: z.boolean().optional().default(false),
  no_gui: z.boolean().optional().default(false),
  supported_architectures: z.nativeEnum(ARCHITECTURES).array().optional(),
});

export type AppInfo = z.infer<typeof appInfoSchema>;
export type FormField = z.infer<typeof formFieldSchema>;

/**
 *  This function checks the requirements for the app with the provided name.
 *  It reads the config.json file for the app, parses it,
 *  and checks if the architecture of the current system is supported by the app.
 *  If the config.json file is invalid, it throws an error.
 *  If the architecture is not supported, it throws an error.
 *
 *  @param {string} appName - The name of the app.
 *  @throws Will throw an error if the app has an invalid config.json file or if the current system architecture is not supported by the app.
 */
export const checkAppRequirements = (appName: string) => {
  const configFile = readJsonFile(`/runtipi/repos/${getConfig().appsRepoId}/apps/${appName}/config.json`);
  const parsedConfig = appInfoSchema.safeParse(configFile);

  if (!parsedConfig.success) {
    throw new Error(`App ${appName} has invalid config.json file`);
  }

  if (parsedConfig.data.supported_architectures && !parsedConfig.data.supported_architectures.includes(getConfig().architecture)) {
    throw new Error(`App ${appName} is not supported on this architecture`);
  }

  return parsedConfig.data;
};

/**
 *  This function checks if the env file for the app with the provided name is valid.
 *  It reads the config.json file for the app, parses it,
 *  and uses the app's form fields to check if all required fields are present in the env file.
 *  If the config.json file is invalid, it throws an error.
 *  If a required variable is missing in the env file, it throws an error.
 *
 *  @param {string} appName - The name of the app.
 *  @throws Will throw an error if the app has an invalid config.json file or if a required variable is missing in the env file.
 */
export const checkEnvFile = async (appName: string) => {
  const configFile = await fs.promises.readFile(`/runtipi/apps/${appName}/config.json`);

  let jsonConfig: unknown;
  try {
    jsonConfig = JSON.parse(configFile.toString());
  } catch (e) {
    throw new Error(`App ${appName} has invalid config.json file`);
  }

  const parsedConfig = appInfoSchema.safeParse(jsonConfig);

  if (!parsedConfig.success) {
    throw new Error(`App ${appName} has invalid config.json file`);
  }

  const envMap = await getAppEnvMap(appName);

  parsedConfig.data.form_fields.forEach((field) => {
    const envVar = field.env_variable;
    const envVarValue = envMap.get(envVar);

    if (!envVarValue && field.required) {
      throw new Error('New info needed. App config needs to be updated');
    }
  });
};

/**
 *  This function generates a random string of the provided length by using the SHA-256 hash algorithm.
 *  It takes the provided name and a seed value, concatenates them, and uses them as input for the hash algorithm.
 *  It then returns a substring of the resulting hash of the provided length.
 *
 *  @param {string} name - A name used as input for the hash algorithm.
 *  @param {number} length - The desired length of the random string.
 */
const getEntropy = (name: string, length: number) => {
  const hash = crypto.createHash('sha256');
  hash.update(name + getSeed());
  return hash.digest('hex').substring(0, length);
};

/**
 *  This function takes an input of unknown type, checks if it is an object and not null,
 *  and returns it as a record of unknown values, if it is not an object or is null, returns an empty object.
 *
 *  @param {unknown} json - The input of unknown type.
 *  @returns {Record<string, unknown>} - The input as a record of unknown values, or an empty object if the input is not an object or is null.
 */
const castAppConfig = (json: unknown): Record<string, unknown> => {
  if (typeof json !== 'object' || json === null) {
    return {};
  }
  return json as Record<string, unknown>;
};

/**
 * This function generates an env file for the provided app.
 * It reads the config.json file for the app, parses it,
 * and uses the app's form fields and domain to generate the env file
 * if the app is exposed and has a domain set, it adds the domain to the env file,
 * otherwise, it adds the internal IP address to the env file
 * It also creates the app-data folder for the app if it does not exist
 *
 * @param {App} app - The app for which the env file is generated.
 * @throws Will throw an error if the app has an invalid config.json file or if a required variable is missing.
 */
export const generateEnvFile = async (app: App) => {
  const configFile = readJsonFile(`/runtipi/apps/${app.id}/config.json`);
  const parsedConfig = appInfoSchema.safeParse(configFile);

  if (!parsedConfig.success) {
    throw new Error(`App ${app.id} has invalid config.json file`);
  }

  const baseEnvFile = readFile('/runtipi/.env').toString();
  const envMap = envStringToMap(baseEnvFile);

  // Default always present env variables
  envMap.set('APP_PORT', String(parsedConfig.data.port));
  envMap.set('APP_ID', app.id);

  const existingEnvMap = await getAppEnvMap(app.id);

  if (parsedConfig.data.generate_vapid_keys) {
    if (existingEnvMap.has('VAPID_PUBLIC_KEY') && existingEnvMap.has('VAPID_PRIVATE_KEY')) {
      envMap.set('VAPID_PUBLIC_KEY', existingEnvMap.get('VAPID_PUBLIC_KEY') as string);
      envMap.set('VAPID_PRIVATE_KEY', existingEnvMap.get('VAPID_PRIVATE_KEY') as string);
    } else {
      const vapidKeys = generateVapidKeys();
      envMap.set('VAPID_PUBLIC_KEY', vapidKeys.publicKey);
      envMap.set('VAPID_PRIVATE_KEY', vapidKeys.privateKey);
    }
  }

  parsedConfig.data.form_fields.forEach((field) => {
    const formValue = castAppConfig(app.config)[field.env_variable];
    const envVar = field.env_variable;

    if (formValue || typeof formValue === 'boolean') {
      envMap.set(envVar, String(formValue));
    } else if (field.type === 'random') {
      if (existingEnvMap.has(envVar)) {
        envMap.set(envVar, existingEnvMap.get(envVar) as string);
      } else {
        const length = field.min || 32;
        const randomString = getEntropy(field.env_variable, length);

        envMap.set(envVar, randomString);
      }
    } else if (field.required) {
      throw new Error(`Variable ${field.label || field.env_variable} is required`);
    }
  });

  if (app.exposed && app.domain) {
    envMap.set('APP_EXPOSED', 'true');
    envMap.set('APP_DOMAIN', app.domain);
    envMap.set('APP_PROTOCOL', 'https');
    envMap.set('APP_HOST', app.domain);
  } else {
    envMap.set('APP_DOMAIN', `${getConfig().internalIp}:${parsedConfig.data.port}`);
    envMap.set('APP_HOST', getConfig().internalIp);
  }

  // Create app-data folder if it doesn't exist
  const appDataDirectoryExists = await fs.promises.stat(`/app/storage/app-data/${app.id}`).catch(() => false);
  if (!appDataDirectoryExists) {
    await fs.promises.mkdir(`/app/storage/app-data/${app.id}`, { recursive: true });
  }

  await fs.promises.writeFile(`/app/storage/app-data/${app.id}/app.env`, envMapToString(envMap));
};

/**
 * Given a template and a map of variables, this function replaces all instances of the variables in the template with their values.
 *
 * @param {string} template - The template to be rendered.
 * @param {Map<string, string>} envMap - The map of variables and their values.
 */
const renderTemplate = (template: string, envMap: Map<string, string>) => {
  let renderedTemplate = template;

  envMap.forEach((value, key) => {
    renderedTemplate = renderedTemplate.replace(new RegExp(`{{${key}}}`, 'g'), value);
  });

  return renderedTemplate;
};

/**
 * Given an app, this function copies the app's data directory to the app-data folder.
 * If a file with an extension of .template is found, it will be copied as a file without the .template extension and the template variables will be replaced
 * by the values in the app's env file.
 *
 * @param {string} id - The id of the app.
 */
export const copyDataDir = async (id: string) => {
  const envMap = await getAppEnvMap(id);

  const appDataDirExists = (await fs.promises.lstat(`/runtipi/apps/${id}/data`).catch(() => false)) as fs.Stats;
  if (!appDataDirExists || !appDataDirExists.isDirectory()) {
    return;
  }

  const dataDir = await fs.promises.readdir(`/runtipi/apps/${id}/data`);

  const processFile = async (file: string) => {
    if (file.endsWith('.template')) {
      const template = await fs.promises.readFile(`/runtipi/apps/${id}/data/${file}`, 'utf-8');
      const renderedTemplate = renderTemplate(template, envMap);

      await fs.promises.writeFile(`/app/storage/app-data/${id}/data/${file.replace('.template', '')}`, renderedTemplate);
    } else {
      await fs.promises.copyFile(`/runtipi/apps/${id}/data/${file}`, `/app/storage/app-data/${id}/data/${file}`);
    }
  };

  const processDir = async (path: string) => {
    await fs.promises.mkdir(`/app/storage/app-data/${id}/data/${path}`, { recursive: true });
    const files = await fs.promises.readdir(`/runtipi/apps/${id}/data/${path}`);

    await Promise.all(
      files.map(async (file) => {
        const fullPath = `/runtipi/apps/${id}/data/${path}/${file}`;

        if ((await fs.promises.lstat(fullPath)).isDirectory()) {
          await processDir(`${path}/${file}`);
        } else {
          await processFile(`${path}/${file}`);
        }
      }),
    );
  };

  await Promise.all(
    dataDir.map(async (file) => {
      const fullPath = `/runtipi/apps/${id}/data/${file}`;

      if ((await fs.promises.lstat(fullPath)).isDirectory()) {
        await processDir(file);
      } else {
        await processFile(file);
      }
    }),
  );
};

/**
  This function reads the apps directory and skips certain system files, then reads the config.json and metadata/description.md files for each app,
  parses the config file, filters out any apps that are not available and returns an array of app information.
  If the config.json file is invalid, it logs an error message.
 */
export const getAvailableApps = async () => {
  const appsDir = readdirSync(`/runtipi/repos/${getConfig().appsRepoId}/apps`);

  const skippedFiles = ['__tests__', 'docker-compose.common.yml', 'schema.json', '.DS_Store'];

  const apps = appsDir
    .map((app) => {
      if (skippedFiles.includes(app)) return null;

      const configFile = readJsonFile(`/runtipi/repos/${getConfig().appsRepoId}/apps/${app}/config.json`);
      const parsedConfig = appInfoSchema.safeParse(configFile);

      if (!parsedConfig.success) {
        Logger.error(`App ${JSON.stringify(app)} has invalid config.json`);
      } else if (parsedConfig.data.available) {
        const description = readFile(`/runtipi/repos/${getConfig().appsRepoId}/apps/${parsedConfig.data.id}/metadata/description.md`);
        return { ...parsedConfig.data, description };
      }

      return null;
    })
    .filter(notEmpty);

  return apps;
};

/**
 *  This function returns an object containing information about the updates available for the app with the provided id.
 *  It checks if the app is installed or not and looks for the config.json file in the appropriate directory.
 *  If the config.json file is invalid, it returns null.
 *  If the app is not found, it returns null.
 *
 *  @param {string} id - The app id.
 */
export const getUpdateInfo = (id: string) => {
  const repoConfig = readJsonFile(`/runtipi/repos/${getConfig().appsRepoId}/apps/${id}/config.json`);
  const parsedConfig = appInfoSchema.safeParse(repoConfig);

  if (parsedConfig.success) {
    return {
      latestVersion: parsedConfig.data.tipi_version,
      latestDockerVersion: parsedConfig.data.version,
    };
  }

  return { latestVersion: 0, latestDockerVersion: '0.0.0' };
};

/**
 *  This function reads the config.json and metadata/description.md files for the app with the provided id,
 *  parses the config file and returns an object with app information.
 *  It checks if the app is installed or not and looks for the config.json file in the appropriate directory.
 *  If the config.json file is invalid, it returns null.
 *  If an error occurs during the process, it logs the error message and throws an error.
 *
 *  @param {string} id - The app id.
 *  @param {App['status']} [status] - The app status.
 */
export const getAppInfo = (id: string, status?: App['status']) => {
  try {
    // Check if app is installed
    const installed = typeof status !== 'undefined' && status !== 'missing';

    if (installed && fileExists(`/runtipi/apps/${id}/config.json`)) {
      const configFile = readJsonFile(`/runtipi/apps/${id}/config.json`);
      const parsedConfig = appInfoSchema.safeParse(configFile);

      if (parsedConfig.success && parsedConfig.data.available) {
        const description = readFile(`/runtipi/apps/${id}/metadata/description.md`);
        return { ...parsedConfig.data, description };
      }
    }

    if (fileExists(`/runtipi/repos/${getConfig().appsRepoId}/apps/${id}/config.json`)) {
      const configFile = readJsonFile(`/runtipi/repos/${getConfig().appsRepoId}/apps/${id}/config.json`);
      const parsedConfig = appInfoSchema.safeParse(configFile);

      if (parsedConfig.success && parsedConfig.data.available) {
        const description = readFile(`/runtipi/repos/${getConfig().appsRepoId}/apps/${id}/metadata/description.md`);
        return { ...parsedConfig.data, description };
      }
    }

    return null;
  } catch (e) {
    Logger.error(`Error loading app: ${id}`);
    throw new Error(`Error loading app: ${id}`);
  }
};

/**
 *  This function ensures that the app folder for the app with the provided name exists.
 *  If the cleanup parameter is set to true, it deletes the app folder if it exists.
 *  If the app folder does not exist, it copies the app folder from the apps repository.
 *
 *  @param {string} appName - The name of the app.
 *  @param {boolean} [cleanup] - A flag indicating whether to cleanup the app folder before ensuring its existence.
 *  @throws Will throw an error if the app folder cannot be copied from the repository
 */
export const ensureAppFolder = (appName: string, cleanup = false): void => {
  if (cleanup && fileExists(`/runtipi/apps/${appName}`)) {
    deleteFolder(`/runtipi/apps/${appName}`);
  }

  if (!fileExists(`/runtipi/apps/${appName}/docker-compose.yml`)) {
    if (fileExists(`/runtipi/apps/${appName}`)) {
      deleteFolder(`/runtipi/apps/${appName}`);
    }
    // Copy from apps repo
    fs.copySync(`/runtipi/repos/${getConfig().appsRepoId}/apps/${appName}`, `/runtipi/apps/${appName}`);
  }
};
