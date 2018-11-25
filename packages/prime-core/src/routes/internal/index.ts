import * as express from 'express';
import { ApolloServer } from 'apollo-server-express';
import { attributeFields, resolver, relay, DateType } from 'graphql-sequelize';
import { omit } from 'lodash';
import { GraphQLObjectType, GraphQLSchema, GraphQLList, GraphQLNonNull, GraphQLString, GraphQLInt, GraphQLInputObjectType, GraphQLBoolean, GraphQLID } from 'graphql';
import * as GraphQLJSON from 'graphql-type-json';
import { ContentType } from '../../models/ContentType';
import { ContentTypeField } from '../../models/ContentTypeField';
import { ContentEntry } from '../../models/ContentEntry';
import { ContentTypeFieldGroup, getFields, setFields, ContentTypeFieldGroupInputType } from './processFields';
import { PageInfo } from '../../types/PageInfo';
import { latestVersion } from '../external/utils/latestVersion';
import { fields } from '../../fields';

export const internalGraphql = async (restart) => {

  const app = express();

  const ContentTypeFieldType = new GraphQLObjectType({
    name: 'ContentTypeField',
    fields: omit({
      ...attributeFields(ContentTypeField),
    }, ['contentTypeId']),
  });

  const ContentTypeType = new GraphQLObjectType({
    name: 'ContentType',
    fields: () => ({
      ...attributeFields(ContentType),
      fields: {
        type: new GraphQLList(ContentTypeFieldType),
        args: {
          limit: { type: GraphQLInt },
          order: { type: GraphQLString },
        },
        resolve: resolver(ContentTypeField, {
          before(opts, args, context, info) {
            opts.where = {
              contentTypeId: info.source.id,
            };
            return opts;
          }
        }),
      }
    }),
  });

  const ContentEntryType = new GraphQLObjectType({
    name: 'ContentEntry',
    fields: omit({
      ...attributeFields(ContentEntry),
      contentType: {
        type: ContentTypeType,
        resolve: resolver(ContentType, {
          before(opts, args, context, info) {
            opts.where = {
              id: info.source.contentTypeId,
            };
            opts.attributeFields = {

            }
            return opts;
          }
        }),
      },
      versions: {
        type: new GraphQLList(
          new GraphQLObjectType({
            name: 'Version',
            fields: {
              versionId: { type: GraphQLID },
              isPublished: { type: GraphQLBoolean },
              createdAt: { type: DateType.default },
              updatedAt: { type: DateType.default },
            }
          }),
        ),
      }
    }),
  });

  const ContentEntryConnectionEdge = new GraphQLObjectType({
    name: 'ContentEntryConnectionEdge',
    fields: {
      node: { type: ContentEntryType },
      cursor: { type: GraphQLString },
    },
  });

  const ContentEntryConnection = new GraphQLObjectType({
    name: 'ContentEntryConnection',
    fields: {
      pageInfo: { type: PageInfo },
      totalCount: { type: GraphQLInt },
      edges: {
        type: new GraphQLList(ContentEntryConnectionEdge)
      },
    },
  });

  const allContentEntries = {
    type: ContentEntryConnection,
    args: {
      contentTypeId: { type: GraphQLID },
      language: { type: GraphQLString },
      limit: { type: GraphQLInt },
      skip: { type: GraphQLInt },
      order: { type: GraphQLString },
    },
    resolve: relay.createConnectionResolver({
      target: ContentEntry,
      before: (findOptions, args, context) => {
        const language = args.language || 'en';
        const published = null;
        const contentReleaseId = null;
        findOptions.having = {
          versionId: latestVersion({ language, published, contentReleaseId }),
        };
        if (args.contentTypeId) {
          findOptions.where.contentTypeId = args.contentTypeId;
        }
        findOptions.offset = args.skip;
        findOptions.group = ['versionId'];
        return findOptions;
      },
      async after(values, args, context, info) {
        if (args.contentTypeId) {
          values.where.contentTypeId = args.contentTypeId;
        }
        const totalCount = await ContentEntry.count({
          distinct: true,
          col: 'entryId',
          where: values.where,
        });
        values.totalCount = totalCount;
        return values;
      },
    }).resolveConnection,
  };

  const Field = new GraphQLObjectType({
    name: 'Field',
    fields: {
      id: { type: GraphQLID },
      title: { type: GraphQLString },
      description: { type: GraphQLString },
      ui: { type: GraphQLString },
    },
  });

  const allFields = {
    type: new GraphQLList(Field),
    resolve() {
      return fields;
    },
  };

  const queryFields = {
    getContentTypeSchema: {
      type: new GraphQLList(ContentTypeFieldGroup),
      args: {
        entryId: { type: GraphQLID },
        contentTypeId: { type: GraphQLID },
      },
      async resolve(root, args, context, info) {
        if (args.entryId && !args.contentTypeId) {
          const entry = await ContentEntry.findOne({
            where: {
              entryId: args.entryId,
            },
          });
          if (!entry || !entry.contentTypeId) {
            return null;
          }
          args.contentTypeId = entry.contentTypeId;
        }
        return await getFields(args.contentTypeId);
      }
    },
    allContentTypes: {
      type: new GraphQLList(ContentTypeType),
      args: {
        limit: { type: GraphQLInt },
        order: { type: GraphQLString },
      },
      resolve: resolver(ContentType),
    },
    allFields,
    allContentEntries,
    ContentType: {
      type: ContentTypeType,
      args: {
        id: { type: GraphQLID },
      },
      resolve: resolver(ContentType, {
        before(opts, args, context) {
          opts.where = {
            id: args.id,
          };
          return opts;
        },
      }),
    },
    ContentTypeField: {
      type: ContentTypeFieldType,
      args: {
        id: { type: new GraphQLNonNull(GraphQLID) },
      },
      resolve: resolver(ContentTypeField),
    },
    ContentEntry: {
      type: ContentEntryType,
      args: {
        entryId: { type: GraphQLID },
        versionId: { type: GraphQLID },
      },
      resolve: resolver(ContentEntry, {
        before(opts, args, context) {
          opts.where = {
            entryId: args.entryId,
          };
          opts.order = [
            ['createdAt', 'DESC'],
          ];
          return opts;
        },
        async after(result, args, context) {
          result.versions = await ContentEntry.findAll({
            attributes: [
              'versionId',
              'isPublished',
              'createdAt',
              'updatedAt',
            ],
            where: {
              entryId: args.entryId,
              language: result.language,
            },
            order: [
              ['createdAt', 'DESC'],
            ],
          });
          console
          return result;
        }
      }),
    },
  };

  const mutationFields = {
    setContentTypeSchema: {
      type: GraphQLBoolean,
      args: {
        contentTypeId: { type: new GraphQLNonNull(GraphQLID) },
        schema: { type: new GraphQLNonNull(new GraphQLList(ContentTypeFieldGroupInputType)) },
      },
      async resolve(root, args, context, info) {
        await setFields(args.contentTypeId, args.schema);
        restart();
        return true;
      },
    },
    createContentType: {
      type: queryFields.ContentType.type,
      args: {
        input: {
          type: new GraphQLInputObjectType({
            name: 'CreateContentTypeInput',
            fields: {
              title: { type: new GraphQLNonNull(GraphQLString) },
              name: { type: GraphQLString },
              isSlice: { type: GraphQLBoolean },
            },
          }),
        }
      },
      async resolve(root, args, context, info) {
        const entry = await ContentType.create({
          name: args.input.name,
          title: args.input.title,
          isSlice: args.input.isSlice,
        });
        restart();
        return entry;
      }
    },
    removeContentType: {
      type: GraphQLBoolean,
      args: {
        id: { type: GraphQLID },
      },
      async resolve(root, args, context, info) {
        const contentType = await ContentType.findById(args.id);
        if (contentType) {
          await contentType.destroy();
          restart();
          return true;
        }
        return false;
      }
    },
    createContentTypeField: {
      type: queryFields.ContentTypeField.type,
      args: {
        input: {
          type: new GraphQLInputObjectType({
            name: 'CreateContentTypeFieldInput',
            fields: {
              contentTypeId: { type: new GraphQLNonNull(GraphQLString) },
              name: { type: new GraphQLNonNull(GraphQLString) },
              title: { type: GraphQLString },
              type: { type: new GraphQLNonNull(GraphQLString) },
              group: { type: GraphQLString },
            },
          }),
        },
      },
      async resolve(root, args, context, info) {

        const contentType = await ContentType.findById(
          args.input.contentTypeId
        );

        if (!contentType) {
          throw new Error("Content Type not valid");
        }

        const entry = await ContentTypeField.create({
          contentTypeId: contentType.id,
          name: args.input.name,
          title: args.input.title,
          type: args.input.type,
          group: args.input.group,
        });

        restart();

        return entry;
      }
    },
    updateContentEntry: {
      type: ContentEntryType,
      args: {
        entryId: { type: new GraphQLNonNull(GraphQLID) },
        language: { type: GraphQLString },
        data: { type: GraphQLJSON },
      },
      async resolve(root, args, context, info) {
        const entry = await ContentEntry.find({
          where: {
            entryId: args.entryId,
          },
          order: [
            ['createdAt', 'DESC'],
          ],
        });

        if (entry) {
          const draftedEntry = await entry.draft(args.data, args.language || 'en');
          return draftedEntry;
        }

        return null;
      }
    },
    createContentEntry: {
      type: ContentEntryType,
      args: {
        contentTypeId: { type: new GraphQLNonNull(GraphQLID) },
        language: { type: GraphQLString },
        data: { type: GraphQLJSON },
      },
      async resolve(root, args, context, info) {
        const entry = await ContentEntry.create({
          isPublished: false,
          contentTypeId: args.contentTypeId,
          language: args.language || 'en',
          data: args.data,
        });

        return entry;
      }
    },
    publishContentEntry: {
      type: ContentEntryType,
      args: {
        versionId: { type: new GraphQLNonNull(GraphQLID) },
      },
      async resolve(root, args, context, info) {
        const entry = await ContentEntry.find({
          where: {
            versionId: args.versionId
          },
        });

        if (entry) {
          const publishedEntry = await entry.publish();
          return publishedEntry;
        }

        return false;
      }
    },
  };

  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      fields: queryFields,
    }),
    mutation: new GraphQLObjectType({
      name: 'Mutation',
      fields: mutationFields,
    }),
  });

  const server = new ApolloServer({
    introspection: true,
    schema,
  });

  server.applyMiddleware({ app });

  return app;
};