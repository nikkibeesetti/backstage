/*
 * Copyright 2020 Spotify AB
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { InputError } from '@backstage/backend-common';
import { Request } from 'express';
import yup from 'yup';

export async function validateRequestBody<T>(
  req: Request,
  schema: yup.Schema<T>,
): Promise<T> {
  const contentType = req.header('content-type');
  if (!contentType) {
    throw new InputError('Content-Type missing');
  } else if (!contentType.match(/^application\/json($|;)/)) {
    throw new InputError('Illegal Content-Type');
  }

  const body = req.body;
  if (!body) {
    throw new InputError('Missing request body');
  }

  try {
    await schema.validate(body, { strict: true });
  } catch (e) {
    throw new InputError(`Malformed request: ${e}`);
  }

  return body as T;
}
