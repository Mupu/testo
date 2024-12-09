#import "EC1_#import_program_param_4";

// See the module for the full explanation

main :: () {
  // make_leak_report(); // never exists which is probably correct, since it should never compile in the firstplace?

  // This should be true, since it compiled fine
  #run print("DEBUGGER=%\n", BASIC.MEMORY_DEBUGGER);
  print("DEBUGGER=%\n", BASIC.MEMORY_DEBUGGER);
}