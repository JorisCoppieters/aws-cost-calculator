'use strict'; // JS: ES5

// ******************************
// Requries:
// ******************************

var c = require('./constants');
var cprint = require('color-print');

// ******************************
// Functions:
// ******************************

function printHelp (in_message) {
    if (in_message) {
        cprint.yellow(in_message);
        console.log();
    }

    cprint.rainbow('AWS Cost Calculator Help');
    console.log();
    cprint.magenta('Version ' + c.VERSION);
    console.log();
    cprint.green('General Options:');
    console.log(cprint.toWhite('--help') + '\t\t\t' + cprint.toCyan('Show this menu'));
    console.log(cprint.toWhite('--version') + '\t\t' + cprint.toCyan('Print the version'));
    console.log();
    cprint.green('Flags:');
    console.log(cprint.toWhite('--schema [FILE]') + '\t\t' + cprint.toCyan('Schema to use for cost calculations'));
    console.log(cprint.toWhite('--days [NUMBER]') + '\t\t' + cprint.toCyan('Number of days to project costs over'));
    console.log(cprint.toWhite('--full') + '\t\t\t' + cprint.toCyan('Show full report'));
    console.log(cprint.toWhite('--no-spot-pricing') + '\t' + cprint.toCyan('Disable spot pricing'));
    console.log(cprint.toWhite('--no-take-down') + '\t\t' + cprint.toCyan('Disable take down'));
    console.log(cprint.toWhite('--no-free-tier') + '\t\t' + cprint.toCyan('Disable free tier'));
}

// ******************************

function printVersion () {
    cprint.green('Version ' + c.VERSION);
}

// ******************************
// Exports:
// ******************************

module.exports['printHelp'] = printHelp;
module.exports['printVersion'] = printVersion;

// ******************************
