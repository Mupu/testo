#import "Basic"()(MEMORY_DEBUGGER=true);
#import "Process";

main :: () {
  
  // Leaks
  command := string.["echo", "Hello, World!"];
  process_result, 
  output_string, 
  error_string, 
  timeout_reached := run_command(..command, capture_and_return_output=true, print_captured_output=true);
  // print("%\n", output_string);
  free(output_string);
  free(error_string);

  // Also leaks
  process_result, 
  output_string, 
  error_string, 
  timeout_reached = run_command("error", "command", capture_and_return_output=true, print_captured_output=true, arg_quoting=.NEVER_QUOTE);
  free(output_string);
  free(error_string);

  // Error leaks
  process_result, 
  output_string, 
  error_string, 
  timeout_reached = run_command("error", "command", capture_and_return_output=true, print_captured_output=true);
  free(output_string);
  free(error_string);

  reset_temporary_storage();
  report := make_leak_report();
  defer deinit(*report);

  if (report.sorted_summaries.count > 0) 
  {
    log_leak_report(report);
    assert(false);
  }
}