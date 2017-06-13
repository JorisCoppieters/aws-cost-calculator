'use strict'; // JS: ES5

// ******************************
//
//
// AWS COST CALCULATOR v1.0.2
//
// 1.0.0
// - Initial release
//
// ******************************

// ******************************
// Requires:
// ******************************

var fs = require('fs');
var minimist = require('minimist');
var cprint = require('color-print');
var c = require('./src/constants');
var help = require('./src/help');

// ******************************
// Constants:
// ******************************

var STR_PAD_LEFT = '[STR_PAD_LEFT]';
var STR_PAD_RIGHT = '[STR_PAD_RIGHT]';

// ******************************
// Globals:
// ******************************

var g_EXTRA_COSTS = 8;

var g_INSTANCE_PRICES = {
  "t2.nano": 0.008,
  "t2.micro": 0.016,
  "t2.small": 0.032,
  "t2.medium": 0.064,
  "c4.large": 0.13,
  "spot": 0.019
};

var g_STORAGE_PRICES = {
  "gp2": 0.12, // Per Gb-month
  "snapshot": 0.055 // Per Gb-month
};

var g_INSTANCE_SPOT_CHANCES = {
  "t2.small": 0.81,
  "t2.medium": 0.88,
  "c4.large": 0.935
};

var g_ELB_PER_HOUR = 0.028;
var g_NAT_PER_HOUR = 0.059;
var g_NAT_PER_GB = 0.059;

var g_USD_EXCHANGE_RATE = 0.7008;
var g_DAYS_IN_MONTH = 31;

var g_ENABLE_SPOT_PRICING = true;
var g_ENABLE_TAKE_DOWN = true;
var g_ENABLE_FREE_TIER = true;

var g_FREE_SSD_STORAGE = 30;
var g_FREE_MICRO_INSTANCE_HOURS = 750;
var g_FREE_ELB_HOURS = 750;

// ******************************
// Arguments:
// ******************************

var g_ARGV = minimist(process.argv.slice(2));

// ******************************
// Script:
// ******************************

if (g_ARGV['help']) {
    help.printHelp();
} else if (g_ARGV['version']) {
    help.printVersion();
} else {
    var schema = g_ARGV['schema'];
    var num_days = g_ARGV['days'] || 1;
    var full_report = g_ARGV['full'];
    var disable_spot_pricing = g_ARGV['no-spot-pricing'];
    var disable_take_down = g_ARGV['no-take-down'];
    var disable_free_tier = g_ARGV['no-free-tier'];

    if (!schema) {
        help.printHelp('Please specifiy a schema');
    } else {
        printAwsCosts(schema, num_days, full_report, disable_spot_pricing, disable_take_down, disable_free_tier);
    }
}

// ******************************
// Functions:
// ******************************

function printAwsCosts (in_schema, in_num_days, in_full_report, in_disable_spot_pricing, in_disable_take_down, in_disable_free_tier) {
    do
    {
        if (!fs.existsSync(in_schema)) {
            cprint.yellow('Failed to load schema: ' + in_schema);
        }
        var services = require(in_schema);
        if (!services) {
            cprint.yellow('Failed to load schema: ' + in_schema);
        }

        var terminal_width = 136; // TODO

        g_ENABLE_SPOT_PRICING = !in_disable_spot_pricing;
        g_ENABLE_TAKE_DOWN = !in_disable_take_down;
        g_ENABLE_FREE_TIER = !in_disable_free_tier;

        var period_elb = 0;
        var period_nat_gb = 0;
        var period_nat_hourly = 0;
        var period_storage_hours = 0;
        var period_instance_type_hours = {};
        var period_instance_type_number = {};
        var extra_costs = g_EXTRA_COSTS;

        var months = parseInt(in_num_days / g_DAYS_IN_MONTH + 0.99999);

        if (g_ENABLE_FREE_TIER)
        {
            period_storage_hours = -g_FREE_SSD_STORAGE * 24 * g_DAYS_IN_MONTH * months; // Free storage
            period_instance_type_hours["t2.micro"] = -g_FREE_MICRO_INSTANCE_HOURS * months; // Free micro usage
        }

        Object.keys(services).forEach(function(service){
            var service_config = services[service];
            var type = jlib_get_property(service_config, "type", false);

            if (type === "nat")
            {
                var nat_configs = jlib_get_property(service_config, "configs", []);
                nat_configs.forEach(function(nat_config){
                    var nat_hours_per_day = jlib_get_property(nat_config, "hours_per_day", 24);
                    var nat_days_per_week = jlib_get_property(nat_config, "days_per_week", 7);
                    var nat_uptime_hours = in_num_days * (nat_days_per_week / 7) * nat_hours_per_day;
                    period_nat_hourly += nat_uptime_hours;
                    period_nat_gb += jlib_get_property(nat_config, "data_transfer", 0) * in_num_days;
                });
                return;
            }

            if (type === "simple")
            {
                var hourly_rate = jlib_get_property(service_config, "per_hour", 0);
                var monthly_rate = jlib_get_property(service_config, "per_month", 0);
                hourly_rate += monthly_rate / (g_DAYS_IN_MONTH * 24);

                extra_costs += hourly_rate * in_num_days * 24;
                return;
            }

            var service_instances = [];

            var dev_config = jlib_get_property(service_config, "dev", false);
            if (dev_config)
            {
                var dev_instances = jlib_get_property(dev_config, "instances", []);
                service_instances = service_instances.concat(dev_instances);

                if (jlib_get_property(dev_config, "elb"))
                    period_elb += 24 * in_num_days;
            }

            var test_config = jlib_get_property(service_config, "test", false);
            if (test_config)
            {
                var test_instances = jlib_get_property(test_config, "instances", []);
                service_instances = service_instances.concat(test_instances);

                if (jlib_get_property(test_config, "elb"))
                    period_elb += 24 * in_num_days;
            }

            var prod_config = jlib_get_property(service_config, "prod", false);
            if (prod_config)
            {
                var prod_instances = jlib_get_property(prod_config, "instances", []);
                service_instances = service_instances.concat(prod_instances);

                if (jlib_get_property(prod_config, "elb"))
                    period_elb += 24 * in_num_days;
            }

            service_instances.forEach(function(instance_config){
                var instance_type = jlib_get_property(instance_config, "type", "t2.micro");

                var instance_gp2_storage = jlib_get_property(instance_config, "ssd", 0);
                var instance_ebs_storage = jlib_get_property(instance_config, "ebs", 0);
                var instance_storage = instance_gp2_storage + instance_ebs_storage;

                var instance_hours_per_day = jlib_get_property(instance_config, "hours_per_day", 24);
                var instance_days_per_week = jlib_get_property(instance_config, "days_per_week", 7);
                var instance_extra_hours = jlib_get_property(instance_config, "extra_hours", 0);

                if (! period_instance_type_number[instance_type])
                    period_instance_type_number[instance_type] = 0;

                period_instance_type_number[instance_type] = period_instance_type_number[instance_type] + 1;

                if (! g_ENABLE_TAKE_DOWN)
                {
                    instance_hours_per_day = 24;
                    instance_days_per_week = 7;
                }

                var instance_uptime_hours = in_num_days * (instance_days_per_week / 7) * instance_hours_per_day + instance_extra_hours;

                period_storage_hours += instance_storage * instance_uptime_hours;

                var period_instance_on_demand_hours = instance_uptime_hours;
                var period_instance_spot_hours = 0;

                if (jlib_get_property(instance_config, "spot", false) && g_ENABLE_SPOT_PRICING)
                {
                    var instance_price = get_instance_price(instance_type);
                    var spot_instance_price = get_instance_price("spot");
                    if (spot_instance_price < instance_price)
                    {
                        if (! period_instance_type_number["spot"])
                            period_instance_type_number["spot"] = 0;

                        period_instance_type_number["spot"] = period_instance_type_number[instance_type] + 1;

                        var instance_spot_chance = get_instance_spot_chance(instance_type);
                        period_instance_on_demand_hours = (1 - instance_spot_chance) * instance_uptime_hours;
                        period_instance_spot_hours = instance_spot_chance * instance_uptime_hours;
                    }
                }

                if (! period_instance_type_hours[instance_type])
                    period_instance_type_hours[instance_type] = 0;

                period_instance_type_hours[instance_type] = period_instance_type_hours[instance_type] + period_instance_on_demand_hours;

                if (period_instance_spot_hours > 0)
                {
                    if (! period_instance_type_hours["spot"])
                        period_instance_type_hours["spot"] = 0;

                    period_instance_type_hours["spot"] = period_instance_type_hours["spot"] + period_instance_spot_hours;
                }
            });
        });

        if (g_ENABLE_FREE_TIER)
        {
            period_storage_hours = Math.max(0, period_storage_hours);
            period_instance_type_hours["t2.micro"] = Math.max(0, period_instance_type_hours["t2.micro"]);
        }

        var hourly_storage_cost = get_storage_price("gp2") / (24 * 30);
        var period_storage_cost = period_storage_hours * hourly_storage_cost;

        var period_nat_hourly_cost = period_nat_hourly * g_NAT_PER_HOUR;
        var period_nat_gb_cost = period_nat_gb * g_NAT_PER_GB;
        var period_nat_cost = period_nat_hourly_cost + period_nat_gb_cost;

        var period_instance_type_hours = sort_instances_array(period_instance_type_hours);
        var period_instance_type_number = sort_instances_array(period_instance_type_number);

        var period_instance_type_costs = [];
        Object.keys(period_instance_type_hours).forEach(function(instance_type){
            var instance_hours = period_instance_type_hours[instance_type];
            period_instance_type_costs[instance_type] = get_instance_price(instance_type) * instance_hours;
        });

        var total_period_instance_type_costs = object_values(period_instance_type_costs).reduce(function (a, b) { return a + b; }, 0);

        var period_elb_hours = Math.max(0, period_elb - g_FREE_ELB_HOURS);
        var period_elb_cost = period_elb_hours * g_ELB_PER_HOUR;

        var subtotal = total_period_instance_type_costs +
            period_elb_cost +
            period_nat_cost +
            period_storage_cost;

        var gst = (subtotal + extra_costs) * 0.15;

        var total_usd = subtotal + extra_costs + gst;

        var col_1 = [];

        if (in_full_report)
        {
            var col_1_col_1 = [];
            col_1_col_1.push(cprint.toCyan("INSTANCE TYPE", true));
            Object.keys(period_instance_type_costs).forEach(function(instance_type){
                var instance_type_cost = period_instance_type_costs[instance_type];
                col_1_col_1.push(cprint.toWhite("- " + instance_type, true));
            });
            col_1_col_1.push(cprint.toCyan("TOTAL", true));

            var col_1_col_2 = [];

            col_1_col_2.push(cprint.toCyan("NUMBER", true));
            var total_instance_number = 0;
            Object.keys(period_instance_type_number).forEach(function(instance_type){
                var instance_type_number = period_instance_type_number[instance_type];
                total_instance_number += instance_type_number;
                col_1_col_2.push(cprint.toLightGray(instance_type_number, true));
            });
            col_1_col_2.push(cprint.toWhite(total_instance_number, true));

            var col_1_col_3 = [];

            col_1_col_3.push(cprint.toCyan("HOURS", true));
            var total_instance_hours = 0;
            var max_hour_length = object_values(period_instance_type_hours).reduce(function(a, b) { return Math.max(color_line_length(to_decimal(b)), a); }, 0) - 2;
            Object.keys(period_instance_type_hours).forEach(function(instance_type){
                var instance_type_hours = period_instance_type_hours[instance_type];
                total_instance_hours += instance_type_hours;
                col_1_col_3.push(cprint.toLightGray(to_decimal(instance_type_hours, max_hour_length) + " h", true));
            });
            col_1_col_3.push(cprint.toWhite(to_decimal(total_instance_hours, max_hour_length) + " h", true));

            var col_1_col_4 = [];

            col_1_col_4.push(cprint.toCyan("COST", true));
            var total_instance_cost = 0;
            var max_price_length = object_values(period_instance_type_costs).reduce(function(a, b) { return Math.max(color_line_length(to_usd(b)) - 6, a); }, 0);
            Object.keys(period_instance_type_costs).forEach(function(instance_type){
                var instance_type_cost = period_instance_type_costs[instance_type];
                total_instance_cost += instance_type_cost;
                col_1_col_4.push(cprint.toYellow(to_usd(instance_type_cost, max_price_length), true));
            });
            col_1_col_4.push(cprint.toLightYellow(to_usd(total_instance_cost, max_price_length), true));

            col_1 = combine_columns(col_1, col_1_col_1, 0);
            col_1 = combine_columns(col_1, col_1_col_2, 5);
            col_1 = combine_columns(col_1, col_1_col_3, 5);
            col_1 = combine_columns(col_1, col_1_col_4, 5);
            col_1.push("");
        }

        col_1.push(cprint.toCyan("SUBTOTAL: ", true) + cprint.toYellow(to_usd(subtotal), true));
        col_1.push(cprint.toCyan("EXTRA COSTS: ", true) + cprint.toYellow(to_usd(extra_costs), true));
        col_1.push(cprint.toCyan("GST: ", true) + cprint.toYellow(to_usd(gst), true));
        col_1.push(cprint.toCyan("TOTAL USD: ", true) + cprint.toYellow(to_usd(total_usd), true));
        col_1.push("");
        col_1.push(cprint.toLightCyan("TOTAL NZD: ", true) + cprint.toLightYellow(to_nzd(total_usd), true));

        var col_2 = [];
        if (in_full_report)
        {
            col_2.push(cprint.toCyan("NAT UPTIME:", true));
            col_2.push("  " + cprint.toLightGray(to_decimal(period_nat_hourly, 0), true) + " h - " + cprint.toYellow(to_usd(period_nat_hourly_cost, 0), true));
            col_2.push("");
            col_2.push(cprint.toCyan("NAT DATA TRANSFER:", true));
            col_2.push("  " + cprint.toLightGray(to_decimal(period_nat_gb, 0), true) + " Gbs - " + cprint.toYellow(to_usd(period_nat_gb_cost, 0), true));
        }

        var col_3 = [];
        if (in_full_report)
        {
            col_3.push(cprint.toCyan("LOAD BALANCING UPTIME:", true));
            col_3.push("  " + cprint.toLightGray(to_decimal(period_elb, 0), true) + " h - " + cprint.toYellow(to_usd(period_elb_cost, 0), true));
            col_3.push("");
            col_3.push(cprint.toCyan("STORAGE:", true));
            col_3.push("  " + cprint.toLightGray(to_decimal(period_storage_hours, 0), true) + " Gbs - " + cprint.toYellow(to_usd(period_storage_cost, 0), true));
        }

        var lines = [];
        lines = combine_columns(lines, col_1, 0);
        lines = combine_columns(lines, col_2, 6);
        lines = combine_columns(lines, col_3, 6);

        var title = "OVER " + in_num_days + " DAY" + (in_num_days === 1 ? '' : 'S');

        lines.unshift("");
        lines.unshift(cprint.toMagenta('-'.repeat(title.length), true));
        lines.unshift(cprint.toMagenta(title, true));

        var output = '';
        output += cprint.toMagenta("/" + "-".repeat(terminal_width - 2) + "\\") + "\n";
        var padded_line_length = terminal_width - 4;
        lines.forEach(function(line){
            var line_length = color_line_length(line);
            var padding = " ".repeat(Math.max(0, padded_line_length - line_length + 1));

            output += cprint.toMagenta("|", "MAGENTA") + " " + line + padding + cprint.toMagenta("|") + "\n";
        });
        output += cprint.toMagenta("\\" + "-".repeat(terminal_width - 2) + "/") + "\n";

        console.log(output);
    }
    while (false);
}

// ******************************

function jlib_get_property (in_object, in_key, in_default_val) {
    return (in_object[in_key] !== undefined) ? in_object[in_key] : in_default_val;
}

// ******************************

function get_storage_price(in_storage_type)
{
    var result = false;

    do
    {
        if (!g_STORAGE_PRICES[in_storage_type])
        {
            result = 0;
            break;
        }

        result = g_STORAGE_PRICES[in_storage_type];
    }
    while (false);

    return result;
}

// ******************************

function get_instance_price(in_instance_type)
{
    var result = false;

    do
    {
        if (!g_INSTANCE_PRICES[in_instance_type])
        {
            result = 0;
            break;
        }

        result = g_INSTANCE_PRICES[in_instance_type];
    }
    while (false);

    return result;
}

// ******************************

function get_instance_spot_chance(in_instance_type)
{
    var result = false;

    do
    {
        if (!g_INSTANCE_SPOT_CHANCES[in_instance_type])
        {
            result = 0;
            break;
        }

        result = g_INSTANCE_SPOT_CHANCES[in_instance_type];
    }
    while (false);

    return result;
}

// ******************************

function sort_instances_array(in_instances_array)
{
    var result = false;

    do
    {
        var keysSorted = Object.keys(in_instances_array).sort(function(a, b) {
            function instanceRank(instance){
                switch (instance)
                {
                    case "spot": return 100;
                    case "t2.nano": return 210;
                    case "t2.micro": return 220;
                    case "t2.small": return 230;
                    case "t2.medium": return 240;
                    case "c4.large": return 350;
                    default: return 0;
                }
            }
            return instanceRank(a) - instanceRank(b);
        });

        var result = {};
        keysSorted.forEach(function (key) {
            var val = in_instances_array[key];
            result[key] = val;
        });
    }
    while (false);

    return result;
}

// ******************************

function object_values (in_object) {
    var values = [];
    Object.keys(in_object).forEach(function(key){
        values.push(in_object[key]);
    });
    return values;
}

// ******************************

function to_usd(in_number, in_col_width)
{
    in_col_width = typeof(in_col_width) === "undefined" ? 3 : in_col_width;

    return "USD " + to_decimal(in_number, in_col_width);
}

// ******************************

function to_nzd(in_number, in_col_width)
{
    in_col_width = typeof(in_col_width) === "undefined" ? 3 : in_col_width;

    return "NZD " + to_decimal(in_number / g_USD_EXCHANGE_RATE, in_col_width);
}

// ******************************

function to_decimal(in_number, in_col_width)
{
    in_col_width = typeof(in_col_width) === "undefined" ? 3 : in_col_width;

    var int_val = parseInt(in_number);
    var decimal_val = parseInt((in_number - int_val) * 100 + 0.5);
    return str_pad(int_val + "." + str_pad(decimal_val, 2, "0"), in_col_width + 3, " ", STR_PAD_LEFT);
}

// ******************************

function str_pad(in_string, in_pad_amount, in_pad_char, in_pad_mode)
{
    in_string = in_string + '';
    var pad = in_pad_char.repeat(in_pad_amount);
    var new_length = Math.max(in_string.length, in_pad_amount);
    if (in_pad_mode === STR_PAD_LEFT) {
        return (pad + in_string).slice(-new_length);
    } else {
        return (in_string + pad).substring(0, new_length);
    }
}

// ******************************

function combine_columns(in_cols_1, in_cols_2, in_col_margin)
{
    in_col_margin = typeof(in_col_margin) === "undefined" ? 10 : in_col_margin;

    var result = false;

    do
    {
        var rows = in_cols_1;

        var cols_1_max_width = in_cols_1.reduce(function(a, b) { return Math.max(color_line_length(b), a); }, 0);
        var cols_2_max_width = in_cols_2.reduce(function(a, b) { return Math.max(color_line_length(b), a); }, 0);

        var row_idx = 0;
        in_cols_2.forEach(function(col) {
            var row = "";
            if (rows[row_idx])
            {
                row = rows[row_idx];
                var row_color_length = row.length - color_line_length(row);
                var row_min_length = cols_1_max_width + row_color_length;
                row = str_pad(row, row_min_length, " ", STR_PAD_RIGHT);
            }

            var col_color_length = col.length - color_line_length(col);
            var col_min_length = cols_2_max_width + col_color_length;
            var col = str_pad(col, col_min_length, " ", STR_PAD_RIGHT);

            row = row + " ".repeat(in_col_margin) + col;
            rows[row_idx] = row;
            row_idx++;
        });

        result = rows;
    }
    while (false);

    return result;
}

// ******************************

function color_line_length(in_line)
{
    var result = false;

    do
    {
        var regexp = new RegExp(/\x1b\[(0;)?([0-9]+)?m/, 'gm');
        var plain_line = ((in_line || '') + '').replace(regexp, '');
        result = plain_line.length;
    }
    while (false);

    return result;
}

// ******************************
// Exports:
// ******************************
