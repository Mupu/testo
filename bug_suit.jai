
//
// Comiles all files in the 'compiler_bugs' directory and runs them if they compile
// and produce a binary. If its a folder it has to contain a 'first.jai' file.
//
// Files must have a prefix of the form <tracking_issue_number>_<PRNumber>[C|R]EC<exit_code>.jai @copyPasta
// Files that start with "CEC" are expected to compile with the exit code that follows
// Files that start with "REC" are expected to run with the exit code that follows
//
// you can pass the test suit a single file to run, instead of running all tests
//       jai bug_suit.jai - <file_to_run>
// you just pass the test name without the path and it has to be in the 'compiler_bugs' directory
//
// The results are written to 'test_results.json'. If it already exists, existing 
// results are overwritten - otherwise they will be appended.

Test_Result :: struct 
{
  passed_test: bool = false; // ifx tried_to_run then run_exit_code == expected_run_exist_code else compilation_exit_code == expected_compilation_exist_code
  file_path: string; @JsonIgnore
  tracking_issue_number: int; @JsonIgnore

  is_runtime_test: bool = false; // if not we ignore runtime

  // compilation results
  expected_compilation_exit_code: int = 0;
  compilation_exit_code: int = -1;

  // run results
  expected_run_exit_code: int = -1;
  run_exit_code: int = -1;

  compiler_output: string;
  compiler_error_output: string;
  runtime_output: string;
  runtime_error_output: string;
};



#run {

  // Don't output anything when triggered by lsp
  #if #exists(JAILS_DIAGNOSTICS_BUILD) then return; 

  // Don't output anything
  set_build_options_dc(.{do_output=false, write_added_strings=false});

  // Only those platforms are supported :platformSpecific
  #assert OS == .WINDOWS || OS == .LINUX;
  
  
  // need to do it like this, so other deferes can be tracked
  defer report_memory_leaks();


  print("\n\n");


  jai_path := get_path_of_running_executable();

  
  args := get_build_options().compile_time_command_line;
  print("Running bug suit with args: %\n", args);



  // Stats
  succeeded := 0;
  failed := 0;
  broken_tests: [..] string;
  broken_tests.allocator = temp;
  test_results: [..] Test_Result;
  test_results.allocator = temp;


  // Get all the test file list
  test_file_list: [..] string;
  defer {
    for test_file_list     free(it);
    array_free(test_file_list);
  }

  // If no arguments are passed, run all the tests
  // Otherwise run the test that was passed as an argument
  if args.count == 0
    visit_files("compiler_bugs", false, *test_file_list, find_all_tests_visitor, visit_directories=true);
  else
    array_add(*test_file_list, copy_string(args[0]));

  // Used to check if issue numbers are unique
  unique_tracking_issue_numbers: [..] int;
  defer { array_free(unique_tracking_issue_numbers); }

  // Compile and run all the test files
  for file_path_to_compile: test_file_list
  {
    test_result: Test_Result;
    test_result.file_path = file_path_to_compile;

    // Extract expected exit code and tracker issue number from file name
    {
      filename := path_filename(file_path_to_compile);
      // If its a folder we need to use the folder name instead of file name
      if starts_with(filename, "first.jai")
      {
        file_path := path_strip_filename(file_path_to_compile);
        file_path.count -= 1; // remove '/'
        filename = path_filename(file_path);
      }

      tracking_issue_number, success, remainder := string_to_int(filename);
      assert(success, "File name does not start with an tracking issue number. File: '%'", filename);

      newly_added := array_add_if_unique(*unique_tracking_issue_numbers, tracking_issue_number);
      assert(newly_added, "Tracking Issue number % is not unique", tracking_issue_number);

      test_result.tracking_issue_number = tracking_issue_number;

      ec_index := find_index_from_left(filename, "EC");
      assert(ec_index != -1, "File name does not contain 'EC'. File: '%'", filename);
      expected_exit_code:, success, remainder = string_to_int(advance(filename, ec_index + 2));
      if (filename[ec_index - 1] == #char "C") // expected compilation exit code
      {
        test_result.expected_compilation_exit_code = expected_exit_code;
      }
      else if (filename[ec_index - 1] == #char "R") // expected run exit code
      {
        test_result.is_runtime_test = true;
        test_result.expected_run_exit_code = expected_exit_code;
      }
      else
      {
        assert(false, "File name does not contain 'CEC' or 'REC'. File: '%'", filename);
      }
    }



    //
    // compile and run the program
    //

    is_broken := false;

    compile_process_result := compile_program(*test_result, jai_path);
    if compile_process_result.type == .FAILED_TO_LAUNCH
    {
      array_add(*broken_tests, file_path_to_compile);
      is_broken = true;
    }

    // make sure this runs only when file exists and is expected to compile
    if test_result.is_runtime_test 
    {
      run_process_result := run_program(*test_result);
      if run_process_result.type == .FAILED_TO_LAUNCH
      {
        array_add(*broken_tests, file_path_to_compile);
        is_broken = true;
      }
    }
      

    if !is_broken 
    {
      if test_result.passed_test
        succeeded += 1;
      else
        failed += 1;
    }

    array_add(*test_results, test_result);
  }

  

  //
  // output test result json
  //

  write_test_results(test_results, "test_results.json");

  // Free output strings
  for test_results {
    free(it.compiler_output);
    free(it.compiler_error_output);
    free(it.runtime_output);
    free(it.runtime_error_output);
  }



  // Cleanup
  {
    DIRS_TO_DELETE_RECURSIVELY :: string.[".bin", ".build"];
    EXTENSIONS_TO_DELETE_RECURSIVELY :: string.["exe", "obj", "pdb", "lib", "dll"]; // :platformSpecific

    cleanup_visitor :: (info: *File_Visit_Info, data: *void) {
      // Ignore directories starting with "_" or ".", delete .bin and .build directories
      if info.is_directory && (
          info.short_name[0] == #char "_" 
          || info.short_name[0] == #char "." 
          || array_find(DIRS_TO_DELETE_RECURSIVELY, info.short_name)
      )
      {
        info.descend_into_directory = false;
        if array_find(DIRS_TO_DELETE_RECURSIVELY, info.short_name)
        {
          delete_directory(info.full_name);
        }
        return;
      }

      if info.is_directory {
        return;
      }

      // Ignore files that are not .jai
      extension, found := path_extension(info.short_name);
      if !found return;

      if !array_find(EXTENSIONS_TO_DELETE_RECURSIVELY, extension) return;

      // p(info.full_name);
      file_delete(info.full_name);
    }
    visit_files("compiler_bugs", true, null, cleanup_visitor, visit_directories=true);
  }

  // Stats
  print_color("\n\nSUCCEEDED: %\n", succeeded, color=.GREEN);
  print_color("FAILED:    %\n", failed, color=.RED);
  print_color("BROKEN:    %\n", broken_tests.count, color=.YELLOW);
  print_color("TOTAL:     ", color=.MAGENTA);
  print_color("%", succeeded, color=.GREEN);
  print_color("/%\n", test_file_list.count - broken_tests.count, color=.MAGENTA);

  if (broken_tests.count > 0)
  {
    print("\n\n BROKEN TESTS: \n");
    for broken_tests    print("    %\n", it);
  }


}

// Visitor to find all test files to run
find_all_tests_visitor :: (info: *File_Visit_Info, test_list: *[..] string) 
{
  // Ignore directories starting with "_" or "." or "modules" folder
  if (info.short_name[0] == #char "_" 
      || info.short_name[0] == #char "." 
      || info.short_name == "modules"
  )
  { 
    if info.is_directory then info.descend_into_directory = false;
    return;
  }

  extension, found := path_extension(info.short_name);
  if !found && !info.is_directory return; // Skip files without extensions
  if found && extension != "jai" return; // Skip files that are not .jai

  if info.is_directory
  {
    entry_file := sprint("%/first.jai", info.full_name);
    if (file_exists(entry_file))
      array_add(test_list, entry_file);
    else
      print("No 'first.jai' file found in directory '%'. Skipping ...", info.full_name);
  }
  else
    array_add(test_list, copy_string(info.full_name));
}


// Compiles the program.
//
// The exit_code will always be 0, when 'outputed_binary_path' is non empty. 
compile_program :: (test_result: *Test_Result, jai_path: string) -> (compile_process_result: Process_Result)
{
  command := tprint("% %", jai_path, test_result.file_path);
  command_split := split(command, " ",, temp);
  // command := split(tprint("echo %", test_list[0]), " ",, temp);
  print("Compiling: 'jai %' ... ", test_result.file_path);

  // exit_code 
  //    0 = success
  //    1 = user error in source code
  //    3 = internal compiler error
  compile_process_result, 
  output_string, 
  error_string, 
  timeout_reached := run_command(..command_split, 
                                working_directory="", 
                                capture_and_return_output=true, 
                                print_captured_output=false,
                                timeout_ms = 5000 // avoid infinite loops
                                );

  test_result.compiler_output = output_string;
  test_result.compiler_error_output = error_string;


  if compile_process_result.type == .FAILED_TO_LAUNCH {
      print_color("Could not run command: '%'\n", command, color=.RED);
      return compile_process_result;
  }

  // Update test_result
  test_result.compilation_exit_code = compile_process_result.exit_code;
  passed_compilation_as_expected := compile_process_result.exit_code == test_result.expected_compilation_exit_code;
  test_result.passed_test = passed_compilation_as_expected;
  

  // :platformSpecific
#if OS == .WINDOWS {
    program_path_to_run := tprint("%.exe", path_strip_extension(test_result.file_path));
} else #if OS == .LINUX {
    program_path_to_run := tprint("%", path_strip_extension(test_result.file_path));
}
  program_does_exist := file_exists(program_path_to_run);

  // Only print if its a compiletime test
  if !test_result.is_runtime_test || test_result.is_runtime_test && !program_does_exist
  {
    status_text := ifx passed_compilation_as_expected
                  then "SUCCESS" 
                  else tprint("FAILURE - Got Exit Code % (timeout reached: %), Expected %", 
                              compile_process_result.exit_code, 
                              timeout_reached,
                              test_result.expected_compilation_exit_code);
    color := ifx passed_compilation_as_expected then Console_Color.GREEN else .RED;
    print_color(status_text, color=color);
  }

  print("\n"); // newline after status text or for runtime tests

  return compile_process_result;
}


// runs the outputed binary and returns the results
run_program :: (test_result: *Test_Result) -> (process_result: Process_Result)
{
#if OS == .WINDOWS {
    program_path_to_run := tprint("%.exe", path_strip_extension(test_result.file_path));
} else #if OS == .LINUX {
    program_path_to_run := tprint("%", path_strip_extension(test_result.file_path));
}
  program_does_exist := file_exists(program_path_to_run);


  print("   Running:     ");
  if !program_does_exist
  {
    print_color("ERROR: '%' was not found. Make sure your test compiles.\n", program_path_to_run, color=.YELLOW);
    return .{ type=.FAILED_TO_LAUNCH };
  }

  print("'%' ... ", program_path_to_run);

  process_result, 
  output_string, 
  error_string, 
  timeout_reached := run_command(program_path_to_run,
                                working_directory="", 
                                capture_and_return_output=true, 
                                print_captured_output=false,
                                timeout_ms = 5000 // avoid infinite loops
                                );

  test_result.runtime_output = output_string;
  test_result.runtime_error_output = error_string;

  if process_result.type == .FAILED_TO_LAUNCH {
      print_color("Could not run command: \"%\"", program_path_to_run, color=.RED);
      return process_result;
  }


  // print("Exit code: % (timeout reached: %)", process_result.exit_code, timeout_reached);

  // Update test_result
  test_result.run_exit_code = process_result.exit_code;
  passed_run_as_expected := process_result.exit_code == test_result.expected_run_exit_code;
  passed_compilation_as_expected := test_result.compilation_exit_code == test_result.expected_compilation_exit_code;
  test_result.passed_test = passed_compilation_as_expected && passed_run_as_expected;


  status_text := ifx passed_run_as_expected
                then "SUCCESS" 
                else tprint("FAILURE - Exit Code % (timeout reached: %)", process_result.exit_code, timeout_reached);
  color := ifx passed_run_as_expected then Console_Color.GREEN else .RED;
  print_color(status_text, color=color);
  print("\n");

  return process_result;
}



// Create the json file and write the results to it
write_test_results :: (test_results: [..] Test_Result, filename: string)
{
  // Get the current compiler version
  current_compiler_version := copy_temporary_string(compiler_get_version_info(null));
  found:, current_compiler_version = split_from_left(current_compiler_version, ",",, temp);
  replace_chars(current_compiler_version, " ", #char "-");

  // Load file if possible, otherwise create a new one
  parse_success, root_value := json_parse_file(filename);
  root_obj := ifx parse_success then root_value.object else New(JSON_Object);
  root_value = json_value(root_obj);
  defer { json_free(root_value); }

  // Add all the test results to the json file, overwriting existing ones
  for test_results
  {
// :platformSpecific
#if OS == .WINDOWS {
      current_platform := "windows";
} else #if OS == .LINUX {
      current_platform := "linux";
}
    // File Path
    json_set(root_obj, 
             tprint("%!file_path", it.tracking_issue_number), 
             json_value(copy_string(it.file_path)),
             dot_character=#char "!"); // ignore dots from version number

    // Issue Number
    json_set(root_obj, 
             tprint("%!tracking_issue_number", it.tracking_issue_number), 
             .{ type=.NUMBER, number= xx it.tracking_issue_number },
             dot_character=#char "!"); // ignore dots from version number

    // Test Result
    test_result_string := json_write_string(it,, temp);
    success, test_result_value := json_parse_string(test_result_string);
    json_set(root_obj, 
             tprint("%!%!%", it.tracking_issue_number, current_compiler_version, current_platform), 
             test_result_value,
             dot_character=#char "!"); // ignore dots from version number
  }

  success := json_write_file(filename, root_value, indent_char = "  ");
  assert(success, "Could not write to file: '%'", filename);
}

#import "Jaison";
#import "Compiler";
#import "File";
#import "File_Utilities";
#import "Process";
#import "String";
#import "Print_Color";
#import "Basic"()(MEMORY_DEBUGGER=true, TEMP_ALLOCATOR_POISON_FREED_MEMORY=true);
#import "System";
#import "Hash_Table";
