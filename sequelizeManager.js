import Sequelize from 'sequelize';
import parse from './parse';
import {merge} from 'ramda';

const timestamp = () => (new Date()).toTimeString();

const SHOW_QUERY_SELECTOR = {
    DATABSES: 'DATABASES',
    TABLES: 'TABLES'
};

export default class SequelizeManager {
    constructor() {
        // TODO: can respondEvent be part of the class?
        this.connectionState = 'none: credentials were not sent';
    }

    login({username, password, database, portNumber, engine, databasePath}) {
        // create new sequelize object
        this.connection = new Sequelize(database, username, password, {
            dialect: engine,
            port: portNumber,
            storage: databasePath
        });
        // returns a message promise from the database
        return this.connection.authenticate();
    }

    updateLog(respondEvent, logMessage) {
        respondEvent.send('channel', {
            log: {
                message: logMessage,
                timestamp: timestamp()
            }
        });
    }

    raiseError(respondEvent, error) {
        console.error(error);
        respondEvent.send('channel', {
            error: merge(error, {timestamp: timestamp()})
        });

    }

    // built-in query to show available databases/schemes
    showDatabases(respondEvent) {
        const SHOW_DATABASES = this.getPresetQuery(SHOW_QUERY_SELECTOR.DATABASES);
        return this.connection.query(SHOW_DATABASES)
            .then(results => {
                respondEvent.send('channel', {
                    databases: results[0], // TODO - why is this nested in an array? can it have multiple arrays of arrays?
                    error: null,
                    /*
                        if user wants to see all databases/schemes, clear
                        tables from previously selected database/schemes
                    */
                    tables: null
                });
            });
    }

    // built-in query to show available tables in a database/scheme
    showTables(respondEvent) {
        this.getPresetQuery(SHOW_QUERY_SELECTOR.TABLES)
            .then(results => {
                const tables = results.map(result => result[Object.keys(result)]);
                respondEvent.send('channel', {
                    error: null,
                    tables
                });
                const promises = tables.map(table => {
                    // TODO: SQL Injection security hole
                    const query = `SELECT * FROM ${table} LIMIT 5`;
                    this.updateLog(respondEvent, query);
                    return this.connection.query(query)
                        .then(selectTableResult => {
                            let parsedRows;
                            if (selectTableResult[0].length === 0) {
                                parsedRows = {
                                    columnnames: ['NA'],
                                    rows: [['empty table']],
                                    ncols: 1,
                                    nrows: 1
                                };
                                this.updateLog(respondEvent, `NOTE: table [${table}] seems to be empty`);
                            } else {
                                parsedRows = parse(selectTableResult[0]);
                            }
                            respondEvent.send('channel', {
                                error: null,
                                [table]: parsedRows
                            });
                        });
                });
                return Promise.all(promises);
            });
    }

    sendQuery(respondEvent, query) {
        this.updateLog(respondEvent, query);
        return this.connection.query(query)
            .then(results => {
                respondEvent.send('channel', {
                    error: null,
                    rows: results
                });
                return results;
            });
    }

    receiveServerQuery(respondEvent, mainWindowContents, query) {
        return this.connection.query(query)
            .then(results => {
                // send back to the server event
                respondEvent.send(parse(results));
                // send updated rows to the app
                mainWindowContents.send('channel', {
                    error: null,
                    rows: results
                });
            });
    }

    disconnect(respondEvent) {
        /*
            does not return a promise for now. open issue here:
            https://github.com/sequelize/sequelize/pull/5776
        */
        this.connection.close();
        respondEvent.send('channel', {
            databases: null,
            error: null,
            rows: null,
            tables: null
        });
    }

    getPresetQuery(showQuerySelector) {
        const dialect = this.connection.options.dialect;
        switch (showQuerySelector) {
            case SHOW_QUERY_SELECTOR.DATABASES:
                switch (dialect) {
                    case 'mysql':
                    case 'mariadb':
                        return 'SHOW DATABASES';
                    case 'postgres':
                        return 'SELECT datname AS database FROM pg_database WHERE datistemplate = false;';
                    case 'mssql':
                        return 'SELECT * FROM Sys.Databases';
                    default:
                        throw new Error('dialect not detected by getPresetQuery');
                }

            case SHOW_QUERY_SELECTOR.TABLES:
                switch (dialect) {
                    case 'mysql':
                    case 'sqlite':
                    case 'mssql':
                    case 'mariadb':
                        return this.connection.showAllSchemas();
                    case 'postgres':
                        return this.connection.query(
                            'SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\';'
                        );

                default:
                    throw new Error('showQuerySelector not detected by getPresetQuery');
                }
        }
    }
}
