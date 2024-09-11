
//
// Comiles all files in the compiler_bugs directory and runs them if they compile
// If its a folder it does the same with the first.jai file inside the folder
//
// Files that start with "EC" are expected to fail with the error code specified after "EC"

Test_Result :: struct {
  file: string;
  passed_test: bool;
  expected_error_code: int;
  compilation_succeeded: bool;
  compilation_exit_code: int;
  did_run: bool;
  run_succeeded: bool;
  run_exit_code: int;
};

Test_Result_Set :: struct {
  version: string;
  succeeded_count: int;
  failed_count: int;
  total_count: int;
  results: [..] Test_Result;
};


#run 
{
  // @todo platform specific
  #assert OS == .WINDOWS || OS == .LINUX;

  jai_path := get_path_of_running_executable();

  // Don't output anything
  set_build_options_dc(.{do_output=false, write_added_strings=false});

  visitor :: (info: *File_Visit_Info, test_list: *[..] string) {
    // Ignore directories starting with "_" or "."
    if (info.short_name[0] == #char "_" 
        || info.short_name[0] == #char "." 
        || info.short_name == "modules"
    )
    { 
      if info.is_directory 
        info.descend_into_directory = false;

      return;
    }

    extension, found := path_extension(info.short_name);
    if !found && !info.is_directory return; // Skip files without extensions
    if found && extension != "jai" return; // Skip files that are not .jai

    if info.is_directory
      array_add(test_list, tprint("%/first.jai", info.full_name));
    else
      array_add(test_list, copy_string(info.full_name,, temp));

    // p(info.full_name);
  }

  // Stats
  succeeded := 0;
  failed := 0;
  test_results: [..] Test_Result;
  array_free(test_results);

  // Get all the test file list
  test_list: [..] string;
  test_list.allocator = temp;
  visit_files("compiler_bugs", false, *test_list, visitor, visit_directories=true);

  log("\n\n");

  // Run the tests
  for test_list
  {
    test: Test_Result;
    expected_error_code := 0;
    name := path_filename(it);

    // Program to run if it exists after compilation
    // @todo platform specific
#if OS == .WINDOWS {
    program := tprint("%.exe", path_strip_extension(it));
} else #if OS == .LINUX {
    program := tprint("%", path_strip_extension(it));
}

    // If its a folder we need to check the folder name instead of file name
    if starts_with(name, "first.jai") {
      copy := path_strip_filename(it);
      copy.count -= 1; // remove /
      name = path_filename(copy);
    }
    
    // We ignore the '!' so we can mark files that passed the test
    if starts_with(name, "EC") || starts_with(name, "!EC")
    {
      skip_count := ifx starts_with(name, "EC") then 2 else 3;
      code, success := string_to_int(advance(name, skip_count));
      if success  expected_error_code = code;
    }

    test.expected_error_code = expected_error_code;

    // Compile Program
    compile_process_result: Process_Result;  
    {
      command := tprint("% %", jai_path, it);
      test.file = copy_string(it,, temp);
      command_split := split(command, " ",, temp);
      // command := split(tprint("echo %", test_list[0]), " ",, temp);
      print("Compiling: 'jai %' ... ", it);

      compile_process_result=, 
      output_string, 
      error_string, 
      timeout_reached := run_command(..command_split, 
                                    working_directory="", 
                                    capture_and_return_output=true, 
                                    print_captured_output=false,
                                    timeout_ms = 5000 // avoid infinite loops
                                    ,, temp);


      if compile_process_result.type == .FAILED_TO_LAUNCH {
          log_error("Could not run command: \"%\"", command);
          continue;
      }

      // log("Exit code: % (timeout reached: %)", process_result.exit_code, timeout_reached);

      


      exit_code_text := "";
      // if compile_process_result.exit_code == {
      //   case 0; exit_code_text = "0";
      //   case 1; exit_code_text = "1 - (USER)";
      //   case 3; exit_code_text = "3 (COMPILER)";
      //   case; exit_code_text = tprint("(UNHANDLED %)", compile_process_result.exit_code);
      // }

      status_text := ifx compile_process_result.exit_code == expected_error_code 
                    then "SUCCESS" 
                    else tprint("FAILURE - Got Exit Code % (timeout reached: %), Expected %", 
                                compile_process_result.exit_code, 
                                timeout_reached,
                                expected_error_code);
      color := ifx compile_process_result.exit_code == expected_error_code then Console_Color.GREEN else .RED;
      if !(expected_error_code == 0 && file_exists(program)) 
        print_color(status_text, color=color);
      print("\n");

    }

    // make sure this runs only when file exists and is expected to compile
    if expected_error_code == 0 && file_exists(program) 
    {
      if compile_process_result.exit_code == 0
      {
        print("   Running:     '%' ... ", program);
        process_result, 
        output_string, 
        error_string, 
        timeout_reached := run_command(program,
                                      working_directory="", 
                                      capture_and_return_output=true, 
                                      print_captured_output=false,
                                      timeout_ms = 5000 // avoid infinite loops
                                      ,, temp);

        if process_result.type == .FAILED_TO_LAUNCH {
            log_error("Could not run command: \"%\"", program);
            continue;
        }

        // log("Exit code: % (timeout reached: %)", process_result.exit_code, timeout_reached);

        test.did_run = true;
        test.run_exit_code = process_result.exit_code;
        test.run_succeeded = process_result.exit_code == 0;

        status_text := ifx process_result.exit_code == 0
                      then "SUCCESS" 
                      else tprint("FAILURE - Exit Code % (timeout reached: %)", process_result.exit_code, timeout_reached);
        color := ifx process_result.exit_code == 0 then Console_Color.GREEN else .RED;
        print_color(status_text, color=color);
        print("\n");

        // if there is a executable we just look at its result
        if process_result.exit_code == 0 
        {
          succeeded += 1;
          test.passed_test = true;
        }
        else
        {
          failed += 1;
          test.passed_test = false;
        }
      }
    }
    else
    {
      test.compilation_exit_code = compile_process_result.exit_code;
      test.compilation_succeeded = compile_process_result.exit_code == expected_error_code;

      // if there is no executable we just look at compile result
      if compile_process_result.exit_code == expected_error_code 
      {
        succeeded += 1;
        test.passed_test = true;
      }
      else
      {
        failed += 1;
        test.passed_test = false;
      }
    }

    array_add(*test_results, test);
  }

  //
  // output test result json
  //

  versionInfo: Version_Info;
  version := compiler_get_version_info(*versionInfo);
  found:, version = split_from_left(version, ",",, temp);
  version = replace(version, " ", "-",, temp);

  parse_version :: (version_string: string) -> Version_Info {
    found, left, right := split_from_left(version_string, "-",, temp);
    assert(found, "Could not parse version string: %", version_string);
    versions := split(right, ".",, temp);
    assert(versions.count == 3, "Invalid version string: %", version_string);
    return .{
      major = string_to_int(versions[0], 10, s32),
      minor = string_to_int(versions[1], 10, s32),
      micro = string_to_int(versions[2], 10, s32)
    };
  }

  compare_version :: (a: Version_Info, b: Version_Info) -> int {
    if a.major != b.major return a.major - b.major;
    if a.minor != b.minor return a.minor - b.minor;
    if a.micro != b.micro return a.micro - b.micro;
    return 0;
  }

  // Create and initialize object
  success, test_result_sets := json_parse_file("test_results.json", [..] Test_Result_Set);

  current_result_set := Test_Result_Set.{
    version = version,
    succeeded_count = succeeded,
    failed_count = failed,
    total_count = test_list.count,
    results = test_results
  };

  // replace result set
  same_version_index := -1;
  smallest_version_index := -1;
  for test_result_sets
  {
    if it.version == version
    {
      same_version_index = it_index;
      break;
    }

    other_version := parse_version(it.version);
    if smallest_version_index == -1 || compare_version(versionInfo, other_version) > 0
    {
      smallest_version_index = it_index;
    }
  }

  // version already exists, replace it
  if same_version_index != -1
  {
    test_result_sets[same_version_index] = current_result_set;
  }
  // if not yet 3 results, add it
  else if test_result_sets.count < 3 // @todo if we ever change this theres other places that break!!!
  {
    array_add(*test_result_sets, current_result_set);
  }
  // new version, replace the oldest version
  else if smallest_version_index != -1
  {
    other_version := parse_version(test_result_sets[smallest_version_index].version);
    assert(compare_version(versionInfo, other_version) > 0, "Version that is supposed to get replaced is not smaller");
    test_result_sets[smallest_version_index] = current_result_set;
  }
  else
  {
    assert(false, "Could not find a version to replace");
  }

  success = json_write_file("test_results.json", test_result_sets, indent_char = "  ");
  assert(success, "Could not write test_results.json");


  // Cleanup
  {
    DIRS_TO_DELETE_RECURSIVELY :: string.[".bin", ".build"];
    EXTENSIONS_TO_DELETE_RECURSIVELY :: string.["exe", "obj", "pdb", "lib", "dll"]; // @todo platform specific

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
  print_color("TOTAL:     ", color=.MAGENTA);
  print_color("%", succeeded, color=.GREEN);
  print_color("/%\n", test_list.count, color=.MAGENTA);
}


#import "Jaison";
#import "Compiler";
#import "File";
#import "File_Utilities";
#import "Process";
#import "String";
#import "Print_Color";
#import "Basic";
#import "System";
