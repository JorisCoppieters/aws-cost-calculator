'use strict'; // JS: ES5

// ******************************
// Requries:
// ******************************

var c = require('./constants');
var cprint = require('color-print');

// ******************************
// Functions:
// ******************************

function print (in_string) {
    process.stdout.write((in_string || '') + '\n');
}

// ******************************

function printHelp (in_message) {
    if (in_message) {
        cprint.yellow(in_message);
    }

    print();
    print(cprint.toBackgroundMagenta(cprint.toWhite(' '.repeat(c.SCRIPT_NAME.length + 9), true)) + ' ' + cprint.toBackgroundMagenta(cprint.toWhite(' '.repeat(c.VERSION.length + 12), true)));
    print(cprint.toBackgroundMagenta(cprint.toWhite('  ' + c.SCRIPT_NAME + ' Help  ', true)) + ' ' + cprint.toBackgroundMagenta(cprint.toWhite('  Version ' + c.VERSION + '  ', true)));
    print(cprint.toBackgroundMagenta(cprint.toWhite(' '.repeat(c.SCRIPT_NAME.length + 9), true)) + ' ' + cprint.toBackgroundMagenta(cprint.toWhite(' '.repeat(c.VERSION.length + 12), true)));
    print();
    cprint.green('General Options:');
    print(cprint.toWhite('--help') + '\t\t\t' + cprint.toCyan('Show this menu'));
    print(cprint.toWhite('--version') + '\t\t' + cprint.toCyan('Print the version'));
    print();
    cprint.green('Flags:');
    print(cprint.toWhite('--schema [FILE]') + '\t\t' + cprint.toCyan('Schema to use for cost calculations'));
    print(cprint.toWhite('--days [NUMBER]') + '\t\t' + cprint.toCyan('Number of days to project costs over'));
    print(cprint.toWhite('--full') + '\t\t\t' + cprint.toCyan('Show full report'));
    print(cprint.toWhite('--buckets') + '\t\t' + cprint.toCyan('Show cost buckets'));
    print(cprint.toWhite('--no-spot-pricing') + '\t' + cprint.toCyan('Disable spot pricing'));
    print(cprint.toWhite('--no-take-down') + '\t\t' + cprint.toCyan('Disable take down'));
    print(cprint.toWhite('--no-free-tier') + '\t\t' + cprint.toCyan('Disable free tier'));
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
