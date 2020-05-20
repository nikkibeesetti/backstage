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

import { ConflictError, NotFoundError } from '@backstage/backend-common';
import Knex from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { DescriptorEnvelope } from '../ingestion/descriptors/types';
import {
  AddDatabaseLocation,
  DatabaseLocation,
  DatabaseLocationUpdateLogEvent,
  DatabaseLocationUpdateLogStatus,
} from './types';

type DbLocationsRow = {
  id: string;
  type: string;
  target: string;
};

export type DbEntityRequest = {
  locationId?: string;
  entity: DescriptorEnvelope;
};

export type DbEntityResponse = {
  locationId?: string;
  entity: DescriptorEnvelope;
};

type DbEntitiesRow = {
  id: string;
  generation: number;
  locationId: string | null;
  apiVersion: string;
  kind: string;
  name: string | null;
  namespace: string | null;
  metadata: string | null;
  spec: string | null;
};

type DbEntitiesSearchRow = {
  entityId: string;
  key: string;
  value: string | null;
};

function entityDbToResponse(row: DbEntitiesRow): DbEntityResponse {
  const entity: DescriptorEnvelope = {
    apiVersion: row.apiVersion,
    kind: row.kind,
    metadata: {
      uid: row.id,
      generation: row.generation,
    },
  };

  if (row.metadata) {
    const metadata = JSON.parse(row.metadata) as DescriptorEnvelope['metadata'];
    entity.metadata = { ...entity.metadata, ...metadata };
  }

  if (row.spec) {
    const spec = JSON.parse(row.spec);
    entity.spec = spec;
  }

  return {
    locationId: row.locationId || undefined,
    entity,
  };
}

function serializeMetadata(
  metadata: DescriptorEnvelope['metadata'],
): DbEntitiesRow['metadata'] {
  if (!metadata) {
    return null;
  }

  const output = { ...metadata };
  delete output.uid;
  delete output.generation;

  return JSON.stringify(output);
}

function serializeSpec(
  spec: DescriptorEnvelope['spec'],
): DbEntitiesRow['spec'] {
  if (!spec) {
    return null;
  }

  return JSON.stringify(spec);
}

function entityRequestToDb(request: DbEntityRequest): DbEntitiesRow {
  return {
    id: request.entity.metadata?.uid || uuidv4(),
    generation: request.entity.metadata?.generation || 1,
    locationId: request.locationId || null,
    apiVersion: request.entity.apiVersion,
    kind: request.entity.kind,
    name: request.entity.metadata?.name || null,
    namespace: request.entity.metadata?.namespace || null,
    metadata: serializeMetadata(request.entity.metadata),
    spec: serializeSpec(request.entity.spec),
  };
}

export class Database {
  constructor(private readonly database: Knex) {}

  async addOrUpdateEntity(request: DbEntityRequest): Promise<DbEntityResponse> {
    const newRow = entityRequestToDb(request);

    return await this.database.transaction<DbEntityResponse>(async tx => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { uid, name, namespace } = request.entity.metadata ?? {};

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let oldRow: DbEntitiesRow | undefined;
      if (uid) {
        const rows = await tx<DbEntitiesRow>('entities')
          .where({ id: uid })
          .select();
        if (rows.length) {
          oldRow = rows[0];
        } else {
          throw new ConflictError('Unexpected uid for new entity');
        }
      }

      if (oldRow) {
        const { name: oldName, namespace: oldNamespace } =
          request.entity.metadata ?? {};
        if (oldName !== request.entity.metadata?.name) {
        }
      }

      await tx<DbEntitiesRow>('entities').insert(newRow);
      const generatedRows = await tx<DbEntitiesRow>('entities')
        .where({ id: newRow.id })
        .select();
      return entityDbToResponse(generatedRows![0]);
    });

    /*
    let oldRow: DbEntitiesRow;
    if (request.entity.metadata?.uid) {
    }
    if (request.entity.metadata?.name) {
    }
    if (request.entity.metadata?.namespace) {
    }

    await this.database.transaction(async tx => {
      const count = await tx<DatabaseComponent>('components')
        .where({ name: component.name })
        .update({ ...component });
      if (!count) {
        await tx<DatabaseComponent>('components').insert({
          ...component,
          id: uuidv4(),
        });
      }
    });
    */
  }

  async entities(): Promise<DbEntityResponse[]> {
    const rows = await this.database<DbEntitiesRow>('entities')
      .orderBy('namespace', 'name')
      .select();

    return rows.map(row => entityDbToResponse(row));
  }

  async entity(name: string, namespace?: string): Promise<DbEntityResponse> {
    const items = await this.database<DbEntitiesRow>('entities')
      .where({ name, namespace: namespace || null })
      .select();

    if (items.length !== 1) {
      throw new NotFoundError(
        `Found no component with name ${name}, namespace ${
          namespace || '<null>'
        }`,
      );
    }

    return entityDbToResponse(items[0]);
  }

  async addLocation(location: AddDatabaseLocation): Promise<DatabaseLocation> {
    return await this.database.transaction<DatabaseLocation>(async tx => {
      const existingLocation = await tx<DatabaseLocation>('locations')
        .where({
          target: location.target,
        })
        .select();

      if (existingLocation?.[0]) {
        return existingLocation[0];
      }

      const id = uuidv4();
      const { type, target } = location;
      await tx<DatabaseLocation>('locations').insert({
        id,
        type,
        target,
      });

      return (await tx<DatabaseLocation>('locations')
        .where({ id })
        .select())![0];
    });
  }

  async removeLocation(id: string): Promise<void> {
    const result = await this.database<DatabaseLocation>('locations')
      .where({ id })
      .del();

    if (!result) {
      throw new NotFoundError(`Found no location with ID ${id}`);
    }
  }

  async location(id: string): Promise<DatabaseLocation> {
    const items = await this.database<DatabaseLocation>('locations')
      .where({ id })
      .select();
    if (!items.length) {
      throw new NotFoundError(`Found no location with ID ${id}`);
    }
    return items[0];
  }

  async locations(): Promise<DatabaseLocation[]> {
    return this.database<DatabaseLocation>('locations').select();
  }

  async addLocationUpdateLogEvent(
    locationId: string,
    status: DatabaseLocationUpdateLogStatus,
    componentName?: string,
    message?: string,
  ): Promise<void> {
    return this.database<DatabaseLocationUpdateLogEvent>(
      'location_update_log',
    ).insert({
      id: uuidv4(),
      status: status,
      location_id: locationId,
      component_name: componentName,
      message,
    });
  }
}
