

var restify = require('restify');
var server = restify.createServer();
// var o = require('odata');
var cache = require('memory-cache');
var builder = require('botbuilder');


var AppInsights = require('applicationinsights');
var appInsightsClient = AppInsights.getClient();
appInsightsClient.trackEvent("ISV Finder Bot Started");


server.listen(process.env.port || 3978, function () {
    console.log('%s listening to %s', server.name, server.url); 
});

var debugMode = false;

function verboseDebug(event, session) {
    if (debugMode || (process.env.NODE_ENV == "development" )) {
    if (session) {session.send(event);}
    console.log(event);
    }
}



//Connect to SQL Server
var Request = require('tedious').Request;
var TYPES = require('tedious').TYPES; 
var Connection = require('tedious').Connection;

//initialize mapping data array

//mappingArray is sourced from SQL Server
var mappingArray = new Array();

function isv() {
    this.id = 0;
    this.title = "";
    this.TE = "";
    this.BE = "";
}


//error logging array
var arrayErr = new Array();



// set up K9 SQL server connection using Application Environment Variables

var k9config = {
    userName: process.env.SQLuserName,
    password: process.env.SQLpassword,
    server: process.env.SQLserver,
    // If you are on Microsoft Azure, you need this:
    options: {encrypt: true, database: process.env.SQLdatabase}
};

var k9connection = new Connection(k9config);
k9connection.on('connect', function(err) {
    // If no error, then good to proceed.
    
        if (err) {
        //    console.log(err);
            arrayErr.push(err);
        } else {
          console.log("Connected to " + this.config.server + " " + this.config.options.database);
          arrayErr.push("Connected to " + this.config.server);
          loadk9MappingArray();  

        };
        
        
});
 //function to execute SQL query    
    
 function loadk9MappingArray() {
      
        request = new Request("SELECT VsoId, Title, AssignedTE, AssignedBE FROM dbo.PartnerIsvs", function(err) {
         if (err) {
            console.log(err);
            arrayErr.push(err);
          }
        else {
            console.log('SQL request succeeded');
            arrayErr.push("SQL request succeeded");
          }
        });

    //unpack data from SQL query
        request.on('row', function(columns) {
            var oIsv = new isv();
            columns.forEach(function(column) {
              if (column.value === null) {
                // mappingArray.push('');
              } else {
                    switch(column.metadata.colName) {
                        case "AssignedTE": 
                            oIsv.TE = column.value;
                            break;
                        case "AssignedBE":
                            oIsv.BE = column.value;
                            break;
                        case "Title":
                            oIsv.title = column.value;
                            break;
                        case "VsoId":
                            oIsv.id = column.value;
                            break;  
                        }  

                    }

            });
            mappingArray.push(oIsv);
            // console.log(oIsv);
        }); 

        k9connection.execSql(request);
    };








//Configure Odata Source 


//
// Set up Connection to GTM SQL db
//
var GTMconfig = {
    userName: process.env.GTMSQLuserName,
    password: process.env.GTMSQLpassword,
    server: process.env.GTMSQLserver,
    // If you are on Microsoft Azure, you need this:
    options: {encrypt: true, database: process.env.GTMSQLdatabase}
};

var GTMconnection = new Connection(GTMconfig);
GTMconnection.on('connect', function(err) {
    // If no error, then good to proceed.
    
        if (err) {
        //    console.log(err);
            arrayErr.push(err);
        } else {
        console.log("Connected to " + this.config.server + " " + this.config.options.database);



        };               
});

function isvCard() {
    this.appId = 0;
    this.isvName = "";
    this.appName = "";
    this.industry = "";
    this.crossIndustry = "";
    this.platform = "";
    this.sellCountry = "";
    this.originCountry = "";
    this.gtmTier = "";
    this.businessModel = "";
    this.readiness = "";
    this.gtmContact = "";
    this.pbeContact = "";
    this.teContact = "";
    this.url = "";
}

var queryString = "";


//===============================================
// Create Readiness name to value map
//===============================================

var readinessMap = new Array();
    readinessMap[0] = "Not Ready";
    readinessMap[1] = "Co-Marketing Ready";
    readinessMap[2] = "Co-Sell Ready";
    readinessMap[3] = "Co-Sell Recomended";

// Create bot and bind to chat
var connector = new builder.ChatConnector({
    appId: process.env.AppID,
    appPassword: process.env.AppSecret
    });
var bot = new builder.UniversalBot(connector);

var searchLimit = 5; //restrict number of results found


server.post('/api/messages', connector.listen());

function initializeSearch(session) {
    if (!session.userData.geography) {session.userData.geography = "%"};
    if (!session.userData.industry) {session.userData.industry = "%"};
    if (!session.userData.platform) {session.userData.platform.name = "%"};
    if (!session.userData.readiness) {session.userData.readiness = "%"};
}


// Create LUIS recognizer that points at our model and add it as the root '/' dialog for our Cortana Bot.
var model = process.env.LUISServiceURL;
var recognizer = new builder.LuisRecognizer(model);
var dialog = new builder.IntentDialog({ recognizers: [recognizer] });
bot.use(builder.Middleware.firstRun({ version: 1.0, dialogId: '*:/firstRun' }));


bot.dialog('/', dialog);

//=============================
//Dialog to handle first run
//============================
bot.dialog('/firstRun', [ 
    function (session) { 
         builder.Prompts.text(session, "Hello... What's your name?"); 
     }, 
     function (session, results) { 
         // We'll save the users name and send them an initial greeting. All  
         // future messages from the user will be routed to the root dialog. 
         session.userData.name = results.response; 
         session.send("Hi %s, welcome to ISVFinderBot. I can help you recomend Applications for your partners as well as find DX contacts.", session.userData.name);
         session.replaceDialog('/Help');  
     } 
 ]); 

//===============================================
// Piece together the query string
//==============================================

function createQueryString(session) {
        queryString = "SELECT TOP " + searchLimit + " Application.ApplicationId, Application.ApplicationName, Application.AccountName, Application.IndustryName, Application.IndustrialSectorName, Application.PlatformName, Application.Readiness, Account.GtmTier, Country.Name AS CountryName, Channel.Name AS ChannelName" 
        + " FROM dbo.Application" 
        + " LEFT JOIN dbo.Account ON Application.AccountId=Account.AccountId"
        + " LEFT JOIN dbo.ApplicationCountry ON Application.ApplicationID=ApplicationCountry.ApplicationId"
        + " LEFT JOIN dbo.Country ON ApplicationCountry.CountryId=Country.CountryId"
        + " LEFT JOIN dbo.ApplicationChannel ON Application.ApplicationId=ApplicationChannel.ApplicationId"
        + " LEFT JOIN dbo.Channel ON ApplicationChannel.ChannelId=Channel.ChannelId"
        + " WHERE ("
        + " ("
        +  "(Application.IsAzure = 'true' AND Application.IsAzure = '" + session.userData.platform.IsAzure + "')"
        +  "OR (Application.IsDynamics = 'true' AND Application.IsDynamics = '" + session.userData.platform.IsDynamics + "')"
        +  "OR (Application.IsOffice365 = 'true' AND Application.IsOffice365 = '" + session.userData.platform.IsOffice365 + "')"
        +  "OR (Application.IsSqlServer = 'true' AND Application.IsSqlServer = '" + session.userData.platform.IsSqlServer + "')"
        +  "OR (Application.IsWindows = 'true' AND Application.IsWindows = '" + session.userData.platform.IsWindows + "')"
        + ")"
        // if (session.userData.geography != 'Any') {queryString = queryString 
            + " AND Country.Name LIKE '" + session.userData.geography + "'"  
        // } ;                               
        // if (session.userData.industry != 'Any') {queryString = queryString 
            + " AND Application.IndustrialSectorName LIKE '" + session.userData.industry + "'"
        // };
        // if (session.userData.readiness != 'Any') {queryString = queryString 
            + " AND Application.Readiness >= " + session.userData.readiness.value
        // };
        // queryString = queryString 
        + " AND ApplicationCountry.HasSellers = 'true'"
        + " AND Channel.Name IS NOT NULL"
        + ") ORDER BY Application.Readiness DESC";

        console.log('Query =', queryString);
};
//===============================================
// Execute SQL Query, unpack results and send to bot
//===============================================
function GTMQuery(session, queryString) {
    //set up SQL request  
    request = new Request( queryString, function(err) {
        if (err) {
        verboseDebug(err);
        }
    else {
        verboseDebug('GTM SQL request succeeded');
        }
    });

    //unpack data from SQL query as it's returned
    request.on('row', function(columns) {
        verboseDebug('received data from SQL');
        var msg = new builder.Message(session);
        var card = new builder.HeroCard(session)
        var result = new isvCard();
        if (session.userData.platform.IsAzure) {result.platform = 'Azure'};
        if (session.userData.platform.IsDynamics) {result.platform = 'Dynamics'};
        if (session.userData.platform.IsOffice365) {result.platform = 'Office365'};
        if (session.userData.platform.IsSqlServer) {result.platform = 'SQL Server'};
        if (session.userData.platform.IsWindows) {result.platform = 'Windows'};                
        columns.forEach(function(column) {
            if (column.value === null) {
            // no data returned in row
            } else {
                switch(column.metadata.colName) {
                    case "ApplicationId":
                        result.appId = column.value;
                        result.url = "https://msgtm.azurewebsites.net/en-US/Applications/" + result.appId + "/view"
                        verboseDebug(result.appId);
                        break;
                    case "ApplicationName": 
                        result.appName = column.value;
                        break;
                    case "AccountName": 
                        result.isvName = column.value;
                        break;
                    case "IndustrialSectorName":
                        result.crossIndustry = column.value;
                        break;
                    case "IndustryName":
                        result.industry = column.value;
                        break;
                    // case "PlatformName":
                    //     result.platform = column.value;
                    //     break;
                    case "CountryName":
                        result.sellCountry = column.value;
                        break;
                    case "GtmTier":
                        result.gtmTier = column.value;
                        break;
                    case "ChannelName":
                        result.businessModel = column.value;
                        break;
                    case "Readiness":
                        result.readiness = column.value;
                        break;                        
                    }  
                card
                    .title(result.appName.substr(0,29))
                    .subtitle(result.isvName.substr(0,14) + ', '+ result.sellCountry + ", " + result.gtmTier.substr(0,6))
                    .text('Ind: ' + result.crossIndustry.substr(0,9) + ' Biz: '+ result.businessModel.substr(0,9) + ' Plat: '+ result.platform  + ' Read: '+ readinessMap[result.readiness])
                    .tap(builder.CardAction.openUrl(session, result.url ))
                msg
                    .attachmentLayout(builder.AttachmentLayout.carousel)
                    .attachments([card]);
                }
            });
        //post result card to bot
        session.send(msg);
    }); 

    //execute SQL request
    GTMconnection.execSql(request);
    };











//=============================
//Dialog to call GTMQuery
//============================
bot.dialog('/searchGTM', [ 
    function (session) { 
        verboseDebug('In searchGTM')
        createQueryString(session); //assemble query string
        GTMQuery(session, queryString); //search db and display results        
        verboseDebug('Exiting searchGTM');
        session.endDialog();
     } 
 ]); 


//=============================
//Dialog to display menu
//============================
bot.dialog('/menu', [
    function (session) {
        var msg = new builder.Message(session)
            .textFormat(builder.TextFormat.xml)
            .attachmentLayout(builder.AttachmentLayout.carousel)
            .attachments([
                 new builder.HeroCard(session)
                    .title("Hi %s! Welcome to ISVFinder", session.userData.name)
                    .subtitle("What are you looking for?")

                    .buttons([
                        builder.CardAction.imBack(session, "appSearchCriteria", "Applications"),
                        builder.CardAction.imBack(session, "dxContacts", "DX Contacts"),
                        ]),
     
            ]);
        builder.Prompts.text(session, msg,{maxRetries: 0});


    },
    function (session, results) {
        if  (results.response && (results.response == 'appSearchCriteria' || results.response == 'dxContacts')) {
            // Launch demo dialog
            verboseDebug('Spotted button press',session);
            session.beginDialog('/' + results.response);
        } else {
            // Exit the menu
            verboseDebug('no button press',session);
            //TO DO pass results for processing as normal client
            // session.replaceDialog(results.response);
            session.replaceDialog('/Help');
        }
    }    
])

//=============================
//Dialog to display help
//============================
bot.dialog('/Help', function (session, args, next) { 
    session.send( "Ask me.... Which Azure apps in Germany target telecommunications sector and are Co-Sell Ready?" ); 
    session.send( "... or Who is the TE for Amazon?" ); 
    session.send( "... or Who manages Facebook?" ); 
    session.send( "... or Which accounts does Ian manage?" ); 
    session.send('Number of results delivered = ' + searchLimit + " (type 'Settings' to change this)");
    session.endDialog();
    }); 

//=============================
//Dialog to handle search for DX Contacts - currently not implemented TO DO
//============================
bot.dialog('/dxContacts', [
    function (session) {
        session.send( "Ask me... Who is the TE for Amazon?" ); 
        session.send( "... or Who manages Facebook?" ); 
        session.send( "... or Which accounts does Ian manage?" ); 
        session.endDialog();
            }
        ]);

//=============================
//Dialog to handle menu intent
//============================

dialog.matches(/menu/i, [
    function (session) {
        session.replaceDialog('/menu');
    }
])


//=============================
//Dialog to handle find_apps intent
//============================

dialog.matches('Find_App', [ 

    function (session, args) {
  
        verboseDebug('Find_App called',session);

        // Resolve and store any entities passed from LUIS.
        initializeSearch(session);


        var geographyEntity = builder.EntityRecognizer.findEntity(args.entities, 'builtin.geography.country');
        var anyGeography= true; 
        var platformEntity = builder.EntityRecognizer.findEntity(args.entities, 'Platform');
        var anyPlatform = true;
        var industryEntity = builder.EntityRecognizer.findEntity(args.entities, 'Industry');
        var anyIndustry = true;
        var readinessEntity = builder.EntityRecognizer.findEntity(args.entities, 'Readiness');           
        var anyReadiness = true;     

        if (geographyEntity) {
            session.userData.geography = geographyEntity.entity;
            verboseDebug('Geography found '+ session.userData.geography,session);
            anyGeography = false;
            } else {
                session.userData.geography = '%';
                verboseDebug('Any Geography',session)
            }
       
        if (platformEntity) {
        session.userData.platform = {'name': platformEntity.entity , 'IsAzure': false, 'IsDynamics': false, 'IsOffice365': false, 'IsSqlServer': false, 'IsWindows': false};
            verboseDebug('Platform found ' + session.userData.platform.name,session);

            if (session.userData.platform.name == "azure") { 
                    session.userData.platform.IsAzure = true;
                    verboseDebug('IsAzure = '+ session.userData.platform.IsAzure, session);
                    }
            if (session.userData.platform.name == "dynamics") { 
                    session.userData.platform.IsDynamics = true;
                    verboseDebug('IsDynamics = '+ session.userData.platform.IsDynamics, session);
                    }
            if (session.userData.platform.name == "office365") { 
                    session.userData.platform.IsOffice365 = true;
                    verboseDebug('IsOffice365 = '+ session.userData.platform.IsOffice365, session);
                    }
            if (session.userData.platform.name == "sql server") { 
                    session.userData.platform.IsSqlServer = true;
                    verboseDebug('IsSqlServer = '+ session.userData.platform.IsSqlServer, session);
                    }
            if (session.userData.platform.name == "windows") { 
                    session.userData.platform.IsWindows = true;
                    verboseDebug('IsWindows = '+ session.userData.platform.IsWindows, session);
                    }
            anyPlatform = false;
            } else {
                session.userData.platform.name = '%';
                verboseDebug('Any Platform',session)
            }
        
        if (industryEntity) {
            session.userData.industry = industryEntity.entity;
            verboseDebug('Industry found ' + session.userData.industry,session);
            anyIndustry = false;
            } else {
                session.userData.industry = '%';
                verboseDebug('Any Industry',session)
            }
        
        if (readinessEntity) {
            session.userData.readiness = {'name': readinessEntity.entity , 'value': 0};
            verboseDebug('Readiness found ' + session.userData.readiness.name, session);
            anyReadiness = false;

            if (session.userData.readiness.name == "not ready") { 
                    session.userData.readiness.value = 0;
                    verboseDebug('Readiness = '+ session.userData.readiness.value, session);
                    }
            if ((session.userData.readiness.name == "co - marketing ready") || (session.userData.readiness.name == "co marketing ready") ) { 
                    session.userData.readiness.value = 1;
                    verboseDebug('Readiness = '+ session.userData.readiness.value, session);
                    }
            if ((session.userData.readiness.name == "co - sell ready") || (session.userData.readiness.name == "co sell ready")) { 
                    session.userData.readiness.value = 2;
                    verboseDebug('Readiness = '+ session.userData.readiness.value, session);
                    }
            if ((session.userData.readiness.name == "co - sell recommended") || (session.userData.readiness.name == "co sell recommended")) { 
                    session.userData.readiness.value = 3;
                    verboseDebug('Readiness = '+ session.userData.readiness.value, session);
                    }

                verboseDebug(session.userData.readiness.name, session);

            } else {
                verboseDebug('Any Readiness',session)
            }
            //  createQueryString(session);

        // if (anyGeography || anyIndustry || anyPlatform || anyReadiness) {
        //     session.replaceDialog('/appSearchCriteria')
        // } else {
            session.replaceDialog('/searchGTM')
        // }

        
        }
   

]);


//=============================
//Dialog to display search criteria
//============================

bot.dialog('/appSearchCriteria', [ 

    function (session) {
     
        verboseDebug('appSearchCriteria called',session);
        initializeSearch(session);
        var geographyButton = session.userData.geography;
        if (geographyButton == '%') {geographyButton = "Any"};
        var platformButton = session.userData.platform.name;
        if (platformButton == '%') {platformButton = "Any"}
        var industryButton = session.userData.industry;
        if (industryButton == '%') {industryButton = "Any"}
        var readinessButton = session.userData.readiness.name;
        if (readinessButton == '%') {readinessButton = "Any"}


        var msg = new builder.Message(session)
            .textFormat(builder.TextFormat.xml)
            .attachmentLayout(builder.AttachmentLayout.carousel)
            .attachments([

                new builder.HeroCard(session)
                    .title("Here are the Application types I'm going to look for")
                    .subtitle("Press Find Apps or change any search parameter")

                    .buttons([
                        builder.CardAction.imBack(session, "changeGeography", "Geography: " + geographyButton),
                        builder.CardAction.imBack(session, "changePlatform", "Platform: " + platformButton),
                        builder.CardAction.imBack(session, "changeIndustry", "Industry: " + industryButton),
                        builder.CardAction.imBack(session, "changeReadiness", "Readiness: " + readinessButton),
                        builder.CardAction.imBack(session, "searchGTM", "Find Apps")
                    ])
     
            ]);
        builder.Prompts.choice(session, msg, "changeGeography|changePlatform|changeIndustry|changeReadiness|searchGTM", {maxRetries: 0})


    },
    function (session, results) {
        if (results.response && results.response.entity != '(quit)') {
            // Launch demo dialog
            session.beginDialog('/' + results.response.entity);
        } else {
            // Exit the menu
            session.endDialog();
        }

    }

]);

bot.dialog('/changeGeography', [
    function (session) {
        builder.Prompts.text(session, 'Type a geography or leave it blank to search everywhere', {maxRetries: 0} );
    },
    function (session, results) {
        session.userData.geography = results.response;
        verboseDebug(results.response,session);
        session.replaceDialog('/appSearchCriteria');
    }
]);

bot.dialog('/changePlatform', [
    function (session) {
        builder.Prompts.choice(session, 'Select a platform',"Azure|Dynamics|Office365|SQL Server|Windows|Any" , {maxRetries: 0});
    },
    function (session, results) {
        if (results.response) {
            session.userData.platform = {'name': "Any" , 'IsAzure': false, 'IsDynamics': false, 'IsOffice365': false, 'IsSqlServer': false, 'IsWindows': false};

            if (results.response.entity == "Azure") { 
                    session.userData.platform = {'name': "Azure", 'IsAzure' : true}
                    verboseDebug('IsAzure = '+ session.userData.platform.IsAzure, session);
                    }
            if (results.response.entity == "Dynamics") { 
                    session.userData.platform = {'name' : "Dynamics", 'IsDynamics': true};
                    verboseDebug('IsDynamics = '+ session.userData.platform.IsDynamics, session);
                    }
            if (results.response.entity == "Office365") { 
                    session.userData.platform = {'name' : "Office365", 'IsOffice365' : true};
                    verboseDebug('IsOffice365 = '+ session.userData.platform.IsOffice365, session);
                    }
            if (results.response.entity == "SQL Server") { 
                    session.userData.platform = {'name': "SQL Server", 'IsSqlServer' : true};
                    verboseDebug('IsSqlServer = '+ session.userData.platform.IsSqlServer, session);
                    }
            if (results.response.entity == "Windows") { 
                    session.userData.platform = {'name' : "Windows", 'IsWindows': true};
                    verboseDebug('IsWindows = '+ session.userData.platform.IsWindows, session);
                    }
        }

        verboseDebug(results.response,session);
        session.replaceDialog('/appSearchCriteria');
    }
]);

bot.dialog('/changeIndustry', [
    function (session) {
        builder.Prompts.text(session, 'Enter an industry  or leave it blank to search all', {maxRetries: 0} );
    },
    function (session, results) {
        session.userData.industry = results.response;
        verboseDebug(results.response,session);
        session.replaceDialog('/appSearchCriteria');
    }
]);

bot.dialog('/changeReadiness', [
    function (session) {
        builder.Prompts.choice(session, 'Select required readiness', "Co-Marketing Ready|Co-Sell Ready|Co-Sell Recommended|Any" ,{maxRetries: 0} );
    },
    function (session, results) {

        session.userData.readiness = {'name': results.response.entity , 'value': 0};

            if ((session.userData.readiness.name == "not ready") || (session.userData.readiness.name == "Any")) { 
                    session.userData.readiness.value = 0;
                    verboseDebug('Readiness = '+ session.userData.readiness.value, session);
                    }
            if (session.userData.readiness.name == "Co-Marketing Ready")  { 
                    session.userData.readiness.value = 1;
                    verboseDebug('Readiness = '+ session.userData.readiness.value, session);
                    }
            if (session.userData.readiness.name == "Co-Sell Ready") { 
                    session.userData.readiness.value = 2;
                    verboseDebug('Readiness = '+ session.userData.readiness.value, session);
                    }
            if (session.userData.readiness.name == "Co-Sell Recommended") { 
                    session.userData.readiness.value = 3;
                    verboseDebug('Readiness = '+ session.userData.readiness.value, session);
                    }

        verboseDebug(session.userData.readiness.name, session);
        session.replaceDialog('/appSearchCriteria');
    }
]);


dialog.matches('Find_ISV_Contact', [
    function (session, args, next) {
        verboseDebug('Find_ISV_Contact called', session);
        // Resolve and store any entities passed from LUIS.
        var accountEntity = builder.EntityRecognizer.findEntity(args.entities, 'Account');
        if (accountEntity) {
            var account = accountEntity.entity;
            // console.log('Account ' + account + ' recognized');
            next({response: account});
            } else {
            // Prompt for account
            builder.Prompts.text(session, 'Which account would you like to find the TE for?');
            } 

        }
    ,
    function (session, results, next) {
        if (results.response) {
            var account = results.response;
            console.log('Account ' + account + ' now recognized')
        }
        next({response: account});

    }
    ,
    function (session, results) {
        var searchAccount = "";
        var account = results.response;
        console.log('in lookup function, account = ' + account);
        // session.send('in lookup function, account = ' + account);
        //create regex version of the searchAccount
        if (!account) {
                // console.log("Sorry, I couldn't make out the name of the account you are looking for.");
                builder.prompts.text(session, "Sorry, I couldn't make out the name of the account you are looking for.");
        } else { 
                (searchAccount = new RegExp(account, 'i'))

        //search mapping array for searchAccount
        var x = 0;
        var found = false;
                // Next line to assist with debugging
                // // console.log("Looking for account");
        while ( x < (mappingArray.length ) ) {
            if (mappingArray[x]) {
            if (mappingArray[x].title.match(searchAccount)) {
            //post results to chat
                // session.send('found account');
                if(mappingArray[x].TE) {
                    // var msg = "The TE for " + mappingArray[x] + " is " + mappingArray[x+1];
                    // console.log( msg); 
                    // session.send('te not null');
                    session.send("The TE for " + mappingArray[x].title + " is " + mappingArray[x].TE);
                    found = true;
                    }
                };
            }
            x++;

            if (x > 570) {session.send('loop counter = ' + x)}

            };
            if (!found) {
                session.send( "Sorry, I couldn't find the TE for " + account)
                };


            
        }

                    // next line to assist with debug
            //   session.endDialog("Dialog Ended");

    }
]);
//===============================End of Find_ISV_Contact==========================

dialog.matches('Settings', [
    function (session, args, next) {
        appInsightsClient.trackEvent("Settings called");  
        console.log('Settings Called');
        verboseDebug('Settings called',session);
        // Resolve and store any entities passed from LUIS.
        var numberEntity = builder.EntityRecognizer.findEntity(args.entities, 'builtin.number');
        if (numberEntity) {
            var number = numberEntity.entity;
            // console.log('Account ' + account + ' recognized');
            next({response: number});
            } else {
            // Prompt for account
            builder.Prompts.text(session, 'How many results would you like to see?');
            } 
        }
    ,
    function (session, results) {
        if (results.response) {
            var number = results.response;
        }
            searchLimit = number;
            console.log('Results now set to ' + number); 
        session.endDialog("Thanks! You'll now see %s results" , number);

    }
    
]);
//===============================End of Find_ISV_Contact==========================


dialog.matches('Find_TE', [
    function (session, args, next) {
        appInsightsClient.trackEvent("Find_TE called");  
        console.log('Find_TE called');
        // session.send('in Find_TE');
        // Resolve and store any entities passed from LUIS.
        var accountEntity = builder.EntityRecognizer.findEntity(args.entities, 'Account');
        if (accountEntity) {
            var account = accountEntity.entity;
            // console.log('Account ' + account + ' recognized');
            next({response: account});
            } else {
            // Prompt for account
            builder.Prompts.text(session, 'Which account would you like to find the TE for?');
            } 

        }
    ,
    function (session, results, next) {
        if (results.response) {
            var account = results.response;
            console.log('Account ' + account + ' now recongized')
        }
        next({response: account});

    }
    ,
    function (session, results) {
        var searchAccount = "";
        var account = results.response;
        console.log('in lookup function, account = ' + account);
        // session.send('in lookup function, account = ' + account);
        //create regex version of the searchAccount
        if (!account) {
                // console.log("Sorry, I couldn't make out the name of the account you are looking for.");
                builder.prompts.text(session, "Sorry, I couldn't make out the name of the account you are looking for.");
        } else { 
                (searchAccount = new RegExp(account, 'i'))

        //search mapping array for searchAccount
        var x = 0;
        var found = false;
                // Next line to assist with debugging
                // // console.log("Looking for account");
        while ( x < (mappingArray.length ) ) {
            if (mappingArray[x]) {
            if (mappingArray[x].title.match(searchAccount)) {
            //post results to chat
                // session.send('found account');
                if(mappingArray[x].TE) {
                    // var msg = "The TE for " + mappingArray[x] + " is " + mappingArray[x+1];
                    // console.log( msg); 
                    // session.send('te not null');
                    session.send("The TE for " + mappingArray[x].title + " is " + mappingArray[x].TE);
                    found = true;
                    }
                };
            }
            x++;

            if (x > 570) {session.send('loop counter = ' + x)}

            };
            if (!found) {
                session.send( "Sorry, I couldn't find the TE for " + account)
                };


            
        }

                    // next line to assist with debug
            //   session.endDialog("Dialog Ended");

    }
]);
//===============================End of Find TE==========================

dialog.matches('Find_BE', [
    function (session, args, next) {
        appInsightsClient.trackEvent("Find_BE called");  
        console.log('Find_BE called');
        // Resolve and store any entities passed from LUIS.
        var accountEntity = builder.EntityRecognizer.findEntity(args.entities, 'Account');
        if (accountEntity) {
            var account = accountEntity.entity;
            // console.log('Account ' + account + ' recognized');
            next({response: account});
            } else {
            // Prompt for account
            builder.Prompts.text(session, 'Which account would you like to find the BE for?');
            } 
        }
    ,
    function (session, results, next) {
        if (results.response) {
            var account = results.response;
            console.log('Account ' + account + ' now recongized')
        }
        next({response: account});

    }
    ,
    function (session, results) {
        var searchAccount = "";
        var account = results.response;
        console.log('in lookup function, account = ' + account);
        //create regex version of the searchAccount
        if (!account) {
                // console.log("Sorry, I couldn't make out the name of the account you are looking for.");
                builder.prompts.text(session, "Sorry, I couldn't make out the name of the account you are looking for.");
        } else { 
                (searchAccount = new RegExp(account, 'i'))

        //search mapping array for searchAccount
        var x = 0;
        var found = false;
                // Next line to assist with debugging
                // // console.log("Looking for account");
        while ( x < mappingArray.length) {
            if (mappingArray[x].title.match(searchAccount)) {
            //post results to chat
                if(mappingArray[x].BE) {
                    // var msg = "The TE for " + mappingArray[x] + " is " + mappingArray[x+1];
                    // console.log( msg); 
                    session.send("The BE for " + mappingArray[x].title + " is " + mappingArray[x].BE);
                    found = true;
                    }
                };
            x++;
            };
            if (!found) {
                session.send( "Sorry, I couldn't find the BE for " + account)
                };

            // next line to assist with debug
            //   session.endDialog("Session Ended");
            
        }

    }
]);
//===============================End of Find BE==========================

dialog.matches('Find_Accounts', [function (session, args, next) { 
    appInsightsClient.trackEvent("Find_Accounts called");  
    //handle the case where intent is List Accounts for BE or TE
    // use bot builder EntityRecognizer to parse out the LUIS entities
    var evangelist = builder.EntityRecognizer.findEntity(args.entities, 'Evangelist'); 
    // session.send( "Recognized Evangelist " + evangelist.entity); 

    // assemble the query using identified entities   
    var searchEvangelist = "";

    //create regex version of the searchEvangelist
    if (!evangelist) {
            session.send("Sorry, I couldn't make out the name of the evangelist you are looking for.");
    } else { 
            (searchEvangelist = new RegExp(evangelist.entity, 'i'))

            // Next line to assist with debugging
            // session.send( "Looking for the accounts for " + searchEvangelist); 

            //search mapping array for searchAccount
            var x = 0;
            var found = false;
                    // Next line to assist with debugging
                    // // console.log("Looking for account");
            while ( x < mappingArray.length) {
                if (mappingArray[x].TE.match(searchEvangelist)) {
                //found TE match
                    if(mappingArray[x].title) {
                        session.send( mappingArray[x].TE + " is TE for " + mappingArray[x].title); 
                        found = true;
                        }
                    };
                if (mappingArray[x].BE.match(searchEvangelist)) {
                //found BE match
                    if(mappingArray[x]) {
                        session.send( mappingArray[x].BE + " is BE for " + mappingArray[x].title); 
                        found = true;
                        }
                    };
                x++
                };
                if (!found) {
                    session.send( "Sorry, I couldn't find the accounts for " + evangelist.entity)
                    };

                // next line to assist with debug
                //   session.endDialog("Session Ended");
                
            }
        }]);   






//===============================End of Find Accounts==========================

dialog.matches('Find_Both', [function (session, args, next) {
        appInsightsClient.trackEvent("Find_both_TE_and_BE called");   
        //    console.log(args.entities); 

        // use bot builder EntityRecognizer to parse out the LUIS entities
        var accountEntity = builder.EntityRecognizer.findEntity(args.entities, 'Account'); 

        // assemble the query using identified entities   
        var searchAccount = "";

        //create regex version of the searchAccount
        if (!accountEntity) {
                session.send("Sorry, I couldn't make out the name of the account you are looking for.");
        } else { 
                (searchAccount = new RegExp(accountEntity.entity, 'i'))

                // Next line to assist with debugging
                // session.send( "Looking for the TE for " + searchAccount); 

                //search mapping array for searchAccount
                var x = 0;
                var found = false;
                        // Next line to assist with debugging
                        // // console.log("Looking for account");
                while ( x < mappingArray.length) {
                    if (mappingArray[x].title.match(searchAccount)) {
                    //post results to chat
                        if(mappingArray[x].TE) {
                            session.send( "The TE for " + mappingArray[x].title + " is " + mappingArray[x].TE); 
                            found = true;
                            }
                        if(mappingArray[x].BE) {
                            session.send( "The BE for " + mappingArray[x].title + " is " + mappingArray[x].BE); 
                            found = true;
                            }
                        };
                    x++;
                    };
                    if (!found) {
                        session.send( "Sorry, I couldn't find the Evangelists for " + accountEntity.entity)
                        };

                    // next line to assist with debug
                    //   session.endDialog("Session Ended");
                    
                }}]);
//===============================End of Find Both==========================

//---------------------------------------------------------------------------------------------------    
//handle the case where there's a request to reload data

dialog.matches('Fetch', function (session, args, next) { 
    appInsightsClient.trackEvent("Find_Fetch called");  
    session.send( "Welcome to ISVFinder on Microsoft Bot Framework. I can help you find the right ISV for your partner." ); 
    // session.send( "Local Partner data is live = " + (partnerISV.length > 0)); 
    //list all errors

    //reload odata
    loadApplicationsArray();
    loadApplicationCountriesArray();
    loadApplicationIndustriesArray();
    loadApplicationContactsArray();
    loadApplicationMaterialsArray();

    arrayErr.forEach(function(item) {
        session.send( "K9 Bot = " + item); 
    });
    session.send( "K9 data is live = " + (mappingArray.length > 0)); 
    session.send( "isvfinderbot applications data is live = " + (Applications.length > 0)); 
        session.send( "isvfinderbot applicationCountry data is live = " + (ApplicationCountries.length > 0)); 
                // session.endDialog("Session Ended");
    });

//---------------------------------------------------------------------------------------------------    
//handle the case where there's no recognized intent

dialog.matches('None', function (session, args, next) { 
    // session.send( "Welcome to ISVFinder on Microsoft Bot Framework. I can help you find the right ISV for your partner." ); 
    
    session.replaceDialog('/menu');
    });
//---------------------------------------------------------------------------------------------------    
//handle the case where intent is happy

dialog.matches('Happy', function (session, args, next) { 
    session.send( "Hope you enjoyed this as much as i did:-) " ); 

    });
//---------------------------------------------------------------------------------------------------    
//handle the case where intent is sad

dialog.matches('Sad', function (session, args, next) { 
    session.send( "Life? Don't talk to me about life. Did you know I've got this terrible pain in all the diodes down my left side? " );
    });    
//---------------------------------------------------------------------------------------------------    
//handle the case where intent is abuse

dialog.matches('Abuse', function (session, args, next) { 
    session.send( "Hey, don't be mean to me:-) " ); 
    });   

//---------------------------------------------------------------------------------------------------    
//handle the case where intent is help

dialog.matches('Help', function (session, args, next) { 
    appInsightsClient.trackEvent("Help called");  
    session.send( "Ask me Which Azure apps in Germany target telecommunications sector?" ); 
    session.send( "... or Who is the TE for Amazon?" ); 
    session.send( "... or Who manages Facebook?" ); 
    session.send( "... or Which accounts does Ian manage?" ); 
    debugMode = !debugMode;
    session.send('Number of results delivered = ' + searchLimit);
    session.send('DebugMode Enabled = ' + debugMode);
        //   session.endDialog("Session Ended");
    });  

//---------------------------------------------------------------------------------------------------



dialog.onDefault(builder.DialogAction.send("Welcome to ISVFinder on Microsoft Bot Framework. I can help you find the right ISV for your partner or find a DX contact."));

// dialog.onBegin(builder.DialogAction.send("What can I help you find? An Application or a DX Contact?"));


// Setup Restify Server 

server.get('/', function (req, res) { 
    cache.put("TEBEMappingList", mappingArray);
    console.log('cache activated'); 
    console.log('cache activated'); 
    res.send('isvfinderbot development environment SQL BRANCH -  Bot Running ' 
        + arrayErr.length + "\n" 
        + arrayErr[0] + "\n" 
        + arrayErr[1] + "\n" 
        + mappingArray.length + "\n"
        + process.env.AppID + "\n"
        + process.env.AppSecret + "\n"
        // + Applications.length + "\n"
        // + ApplicationCountries.length + "\n"
        // + ApplicationIndustries.length
        ); 
    arrayErr.forEach(function(item) { 
    // console.log( "K9 Bot = " + item);  
    }); 
    // res.send('K9 Production Bot Running');
}); 


//some comments
