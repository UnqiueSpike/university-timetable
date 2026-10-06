import {table,string,createSchema,createBuilder,defineQueriesWithType,defineQueryWithType} from "@rocicorp/zero";
const signal=table("sync_signal").columns({user_id:string(),revision:string()}).primaryKey("user_id");
export const syncSchema=createSchema({tables:[signal],enableLegacyQueries:false,enableLegacyMutators:false});
const zql=createBuilder(syncSchema),query=defineQueryWithType<typeof syncSchema,{id:string}>();
export const syncQueries=defineQueriesWithType<typeof syncSchema>()({mine:query(({ctx})=>zql.sync_signal.where("user_id",ctx.id))});
