import React, { useEffect, useRef, useState, useReducer } from 'react';
import '../../ActivityLevels.less';
import { compileArduinoCode, handleSave } from '../../Utils/helpers';
import { message, Spin, Row, Col, Alert, Dropdown, Menu } from 'antd';
import { getSaves } from '../../../../Utils/requests';
import CodeModal from '../modals/CodeModal';
import ConsoleModal from '../modals/ConsoleModal';
import PlotterModal from '../modals/PlotterModal';
import DisplayDiagramModal from '../modals/DisplayDiagramModal'
import VersionHistoryModal from '../modals/VersionHistoryModal';
import {
  connectToPort,
  handleCloseConnection,
  handleOpenConnection,
} from '../../Utils/consoleHelpers';
import ArduinoLogo from '../Icons/ArduinoLogo';
import PlotterLogo from '../Icons/PlotterLogo';
import { useNavigate } from 'react-router-dom';
import ReactPlayer from 'react-player/youtube';

let plotId = 1;

export default function StudentCanvas({ activity }) {
  const link = localStorage.getItem('link');
  const [hoverSave, setHoverSave] = useState(false);
  const [hoverUndo, setHoverUndo] = useState(false);
  const [hoverRedo, setHoverRedo] = useState(false);
  const [hoverCompile, setHoverCompile] = useState(false);
  const [hoverImage, setHoverImage] = useState(false);
  const [hoverConsole, setHoverConsole] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [showPlotter, setShowPlotter] = useState(false);
  const [plotData, setPlotData] = useState([]);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [selectedCompile, setSelectedCompile] = useState(false);
  const [compileError, setCompileError] = useState('');
  const [saves, setSaves] = useState({});
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [lastAutoSave, setLastAutoSave] = useState(null);

  const [forceUpdate] = useReducer((x) => x + 1, 0);
  const navigate = useNavigate();
  const workspaceRef = useRef(null);
  const activityRef = useRef(null);

  const replayRef = useRef([]);
  const clicks = useRef(0);

  const setWorkspace = () => {
    workspaceRef.current = window.Blockly.inject('blockly-canvas', {
      toolbox: document.getElementById('toolbox'),
    });
    window.Blockly.addChangeListener(blocklyEvent);
  };

  const loadSave = (selectedSave) => {
    try {
      let toLoad = activity.template;
      if (selectedSave !== -1) {
        if (lastAutoSave && selectedSave === -2) {
          toLoad = lastAutoSave.workspace;
          setLastSavedTime(getFormattedDate(lastAutoSave.updated_at));
        } else if (saves.current && saves.current.id === selectedSave) {
          toLoad = saves.current.workspace;
          setLastSavedTime(getFormattedDate(saves.current.updated_at));
        } else {
          const s = saves.past.find((save) => save.id === selectedSave);
          if (s) {
            toLoad = s.workspace;
            setLastSavedTime(getFormattedDate(s.updated_at));
          } else {
            message.error('Failed to restore save.');
            return;
          }
        }
      } else {
        setLastSavedTime(null);
      }
      let xml = window.Blockly.Xml.textToDom(toLoad);
      if (workspaceRef.current) workspaceRef.current.clear();
      window.Blockly.Xml.domToWorkspace(xml, workspaceRef.current);
      workspaceRef.current.clearUndo();
    } catch (e) {
      message.error('Failed to load save.');
    }
  };

  const pushEvent = (type, blockId = '') => {
    let blockType = '';
    if (blockId !== '') {
      let type = window.Blockly.mainWorkspace.getBlockById(blockId)?.type;
      type ? blockType = type : blockType = ''; 
    }

    let xml = window.Blockly.Xml.workspaceToDom(workspaceRef.current);
    let xml_text = window.Blockly.Xml.domToText(xml);
    replayRef.current.push({
      xml: xml_text,
      action: type,
      blockId: blockId,
      blockType: blockType,
      timestamp: Date.now(),
      clicks: clicks.current,
    });
  };

  let blocked = false;
  const blocklyEvent = (event) => {
    // if it is a click event, add click
    if (
      (event.type === 'ui' && event.element === 'click') ||
      event.element === 'selected'
    ) {
      clicks.current++;
    }

    // if it is other ui events or create events or is [undo, redo], return
    if (event.type === 'ui' || !event.recordUndo) {
      return;
    }

    // if event is in timeout, return
    if (event.type === 'change' && blocked) {
      return;
    }

    // if the event is change field value, only accept the latest change
    if (
      event.type === 'change' &&
      event.element === 'field' &&
      replayRef.current.length > 1 &&
      replayRef.current[replayRef.current.length - 1].action ===
        'change field' &&
      replayRef.current[replayRef.current.length - 1].blockId === event.blockId
    ) {
      replayRef.current.pop();
    }

    // event delete always comes after a move, ignore the move
    if (event.type === 'delete') {
      if (replayRef.current[replayRef.current.length - 1].action === 'move') {
        replayRef.current.pop();
      }
    }

    // if event is change, add the detail action type
    if (event.type === 'change' && event.element) {
      pushEvent(`${event.type} ${event.element}`, event.blockId);
    } else {
      pushEvent(event.type, event.blockId);
    }

    // timeout for half a second
    blocked = true;
    setTimeout(() => {
      blocked = false;
    }, 500);
  };

  useEffect(() => {
    // automatically save workspace every min
    let autosaveInterval = setInterval(async () => {
      if (workspaceRef.current && activityRef.current) {
        const res = await handleSave(
          activityRef.current.id,
          workspaceRef,
          replayRef.current
        );
        if (res.data) {
          setLastAutoSave(res.data[0]);
          setLastSavedTime(getFormattedDate(res.data[0].updated_at));
        }
      }
    }, 60000);

    // clean up - saves workspace and removes blockly div from DOM
    return async () => {
      clearInterval(autosaveInterval);
    };
  }, []);

  useEffect(() => {
    // once the activity state is set, set the workspace and save
    const setUp = async () => {
      activityRef.current = activity;
      if (!workspaceRef.current && activity && Object.keys(activity).length !== 0) {
        setWorkspace();

        let onLoadSave = null;
        const res = await getSaves(activity.id);
        if (res.data) {
          if (res.data.current) onLoadSave = res.data.current;
          setSaves(res.data);
        } else {
          console.log(res.err);
        }

        if (onLoadSave) {
          let xml = window.Blockly.Xml.textToDom(onLoadSave.workspace);
          window.Blockly.Xml.domToWorkspace(xml, workspaceRef.current);
          replayRef.current = onLoadSave.replay;
          setLastSavedTime(getFormattedDate(onLoadSave.updated_at));
        } else if (activity.template) {
          let xml = window.Blockly.Xml.textToDom(activity.template);
          window.Blockly.Xml.domToWorkspace(xml, workspaceRef.current);
        }

        pushEvent('load workspace');
        workspaceRef.current.clearUndo();
      }
    };
    setUp();
  }, [activity]);

  const handleManualSave = async () => {
    // save workspace then update load save options
    pushEvent('save');
    const res = await handleSave(activity.id, workspaceRef, replayRef.current);
    if (res.err) {
      message.error(res.err);
    } else {
      setLastSavedTime(getFormattedDate(res.data[0].updated_at));
      message.success('Workspace saved successfully.');
    }

    const savesRes = await getSaves(activity.id);
    if (savesRes.data) setSaves(savesRes.data);
  };

  const handleUndo = () => {
    if (workspaceRef.current.undoStack_.length > 0) {
      workspaceRef.current.undo(false);
      pushEvent('undo');
    }
  };

  const handleRedo = () => {
    if (workspaceRef.current.redoStack_.length > 0) {
      workspaceRef.current.undo(true);
      pushEvent('redo');
    }
  };

  const handleConsole = async () => {
    if (showPlotter) {
      message.warning('Close serial plotter before openning serial monitor');
      return;
    }
    // if serial monitor is not shown
    if (!showConsole) {
      // connect to port
      await handleOpenConnection(9600, 'newLine');
      // if fail to connect to port, return
      if (typeof window['port'] === 'undefined') {
        message.error('Fail to select serial device');
        return;
      }
      setConnectionOpen(true);
      setShowConsole(true);
      pushEvent('show serial monitor');
    }
    // if serial monitor is shown, close the connection
    else {
      if (connectionOpen) {
        await handleCloseConnection();
        setConnectionOpen(false);
      }
      setShowConsole(false);
    }
  };

  const handlePlotter = async () => {
    if (showConsole) {
      message.warning('Close serial monitor before openning serial plotter');
      return;
    }

    if (!showPlotter) {
      await handleOpenConnection(
        9600,
        'plot',
        plotData,
        setPlotData,
        plotId,
        forceUpdate
      );
      if (typeof window['port'] === 'undefined') {
        message.error('Fail to select serial device');
        return;
      }
      setConnectionOpen(true);
      setShowPlotter(true);
      pushEvent('show serial plotter');
    } else {
      plotId = 1;
      if (connectionOpen) {
        await handleCloseConnection();
        setConnectionOpen(false);
      }
      setShowPlotter(false);
    }
  };
  const handleCompile = async () => {
    if (showConsole || showPlotter) {
      message.warning(
        'Close Serial Monitor and Serial Plotter before uploading your code'
      );
    } else {
      if (typeof window['port'] === 'undefined') {
        await connectToPort();
      }
      if (typeof window['port'] === 'undefined') {
        message.error('Fail to select serial device');
        return;
      }
      setCompileError('');
      await compileArduinoCode(
        workspaceRef.current,
        setSelectedCompile,
        setCompileError,
        activity,
        true
      );
      pushEvent('compile');
    }
  };

  const handleGoBack = () => {
    if (
      window.confirm(
        'All unsaved progress will be lost. Do you still want to go back?'
      )
    )
      navigate(-1);
  };

  const getFormattedDate = (value, locale = 'en-US') => {
    let output = new Date(value).toLocaleDateString(locale);
    return output + ' ' + new Date(value).toLocaleTimeString(locale);
  };

  const menu = (
    <Menu>
      <Menu.Item onClick={handlePlotter}>
        <PlotterLogo />
        &nbsp; Show Serial Plotter
      </Menu.Item>
      <Menu.Item>
        <CodeModal title={'Arduino Code'} workspaceRef={workspaceRef.current} />
      </Menu.Item>
    </Menu>
  );

  // Caption languages dropdown
  const captions = (
    <Menu>
      <Menu.Item>
        <div>English</div>
      </Menu.Item>
      <Menu.Item>
        <div>Spanish</div>
      </Menu.Item>
    </Menu>
  );

  return (
    <div id='horizontal-container' className='flex flex-column'>
      <div className='flex flex-row'>
        <div
          id='bottom-container'
          className='flex flex-column vertical-container overflow-visible'
        >
          <Spin
            tip='Compiling Code Please Wait... It may take up to 20 seconds to compile your code.'
            className='compilePop'
            size='large'
            spinning={selectedCompile}
          >
            <Row id='icon-control-panel'>
              <Col flex='none' id='section-header'>
                {activity.lesson_module_name}
              </Col>
              <Col flex='auto'>
                <Row align='middle' justify='end' id='description-container'>
                  <Col flex={'30px'}>
                    <button
                      onClick={handleGoBack}
                      id='link'
                      className='flex flex-column'
                    >
                      <i id='icon-btn' className='fa fa-arrow-left' />
                    </button>
                  </Col>
                  <Col flex='auto' />

                  <Col flex={'300px'}>
                    {lastSavedTime ? `Changes saved ${lastSavedTime}` : ''}
                  </Col>
                  <Col flex={'350px'}>
                    <Row>
                      <Col className='flex flex-row' id='icon-align'>
                        <VersionHistoryModal
                          saves={saves}
                          lastAutoSave={lastAutoSave}
                          defaultTemplate={activity}
                          getFormattedDate={getFormattedDate}
                          loadSave={loadSave}
                          pushEvent={pushEvent}
                        />
                        <button
                          onClick={handleManualSave}
                          id='link'
                          className='flex flex-column'
                        >
                          <i
                            id='icon-btn'
                            className='fa fa-save'
                            onMouseEnter={() => setHoverSave(true)}
                            onMouseLeave={() => setHoverSave(false)}
                          />
                          {hoverSave && (
                            <div className='popup ModalCompile4'>Save</div>
                          )}
                        </button>
                      </Col>

                      <Col className='flex flex-row' id='icon-align'>
                        <button
                          onClick={handleUndo}
                          id='link'
                          className='flex flex-column'
                        >
                          <i
                            id='icon-btn'
                            className='fa fa-undo-alt'
                            style={
                              workspaceRef.current
                                ? workspaceRef.current.undoStack_.length < 1
                                  ? { color: 'grey', cursor: 'default' }
                                  : null
                                : null
                            }
                            onMouseEnter={() => setHoverUndo(true)}
                            onMouseLeave={() => setHoverUndo(false)}
                          />
                          {hoverUndo && (
                            <div className='popup ModalCompile4'>Undo</div>
                          )}
                        </button>
                        <button
                          onClick={handleRedo}
                          id='link'
                          className='flex flex-column'
                        >
                          <i
                            id='icon-btn'
                            className='fa fa-redo-alt'
                            style={
                              workspaceRef.current
                                ? workspaceRef.current.redoStack_.length < 1
                                  ? { color: 'grey', cursor: 'default' }
                                  : null
                                : null
                            }
                            onMouseEnter={() => setHoverRedo(true)}
                            onMouseLeave={() => setHoverRedo(false)}
                          />
                          {hoverRedo && (
                            <div className='popup ModalCompile4'>Redo</div>
                          )}
                        </button>
                      </Col>
                    </Row>
                  </Col>
                  <Col flex={'180px'}>
                    <div
                      id='action-btn-container'
                      className='flex space-around'
                    >
                      <ArduinoLogo
                        setHoverCompile={setHoverCompile}
                        handleCompile={handleCompile}
                      />
                      {hoverCompile && (
                        <div className='popup ModalCompile'>
                          Upload to Arduino
                        </div>
                      )}
                    <DisplayDiagramModal
                      image={activity.images}
                    />
                      <i
                        onClick={() => handleConsole()}
                        className='fas fa-terminal hvr-info'
                        style={{ marginLeft: '6px' }}
                        onMouseEnter={() => setHoverConsole(true)}
                        onMouseLeave={() => setHoverConsole(false)}
                      />
                      {hoverConsole && (
                        <div className='popup ModalCompile'>
                          Show Serial Monitor
                        </div>
                      )}
                      <Dropdown overlay={menu}>
                        <i className='fas fa-ellipsis-v'></i>
                      </Dropdown>
                    </div>
                  </Col>
                </Row>
              </Col>
            </Row>
            <div id='blockly-canvas' />
          </Spin>
        </div>

        <ConsoleModal
          show={showConsole}
          connectionOpen={connectionOpen}
          setConnectionOpen={setConnectionOpen}
        ></ConsoleModal>
        <PlotterModal
          show={showPlotter}
          connectionOpen={connectionOpen}
          setConnectionOpen={setConnectionOpen}
          plotData={plotData}
          setPlotData={setPlotData}
          plotId={plotId}
        />          
      </div>

      {/* This xml is for the blocks' menu we will provide. Here are examples on how to include categories and subcategories */}
      <xml id='toolbox' is='Blockly workspace'>
        {
          // Maps out block categories
          activity &&
            activity.toolbox &&
            activity.toolbox.map(([category, blocks]) => (
              <category name={category} is='Blockly category' key={category}>
                {
                  // maps out blocks in category
                  // eslint-disable-next-line
                  blocks.map((block) => {
                    return (
                      <block
                        type={block.name}
                        is='Blockly block'
                        key={block.name}
                      />
                    );
                  })
                }
              </category>
            ))
        }
      </xml>

     
      {/* Embedding the YouTube Video */}
      
      <div id='horizontal-container' className='flex flex-col'>  {/*content wrappers*/}
        <div className='flex flex-row'>
          {/*if you dont put the content in a bottom container, it just wont show up*/}
          <div
            id='bottom-container'
            className='flex flex-column vertical-container overflow-visible'
            style={{width:'97.25vw', maxHeight: '70vh', /*backgroundColor:'gold'*/}}
          >
            {/*the blue tab header*/}
            <Row id='icon-control-panel'>
              <Col flex='none' id='section-header'>
                Lesson Video
              </Col>
            </Row>

            {/*put content into 'Col's and wrap them all in 'Row's*/}
            <Row style={{/*backgroundColor:'yellow'*/}} wrap={false}>
              <Col style={{/*backgroundColor:'blue'*/}}>
                  <div id='container' style={{padding: '30px 0 0 30px'}}>
                    <ReactPlayer url={activity.link} controls={true} /> {/*video player*/}
                  </div>
              </Col>

              {/*transcript button plus window*/}
              <Col span={10} offset={1} style={{backgroundColor:'#A6A6A6'}} flex="flex flex-column" >
                <Row id='icon-control-panel' style={{/*backgroundColor:'pink'*/}} justify={"space-around"}>
                  <Col>
                    <button id='secondary-section-header' style={{left:"0", fontSize: "medium", width: "20vw", height: "5vh", marginTop: '10px', marginBottom: '10px'}}>Generate Transcript</button>
                  </Col>
                </Row>
                <div className='content-container' style={{overflowY: 'scroll', maxHeight: '45vh', backgroundColor: "lightgray"}}> 
                  {/*---------------------------------------------------------------------------------------------
                  this is where the method of getting the transcription would be called instead of this paragraph
                  -----------------------------------------------------------------------------------------------*/}
                    <p>
                      A copypasta is a block of text copied and pasted to the internet and social media. Copypasta containing controversial ideas or lengthy rants are often posted for humorous purposes, to provoke reactions from those unaware that the posted text is a meme. A copypasta is a block of text copied and pasted to the internet and social media. Copypasta containing controversial ideas or lengthy rants are often posted for humorous purposes, to provoke reactions from those unaware that the posted text is a meme.A copypasta is a block of text copied and pasted to the internet and social media. Copypasta containing controversial ideas or lengthy rants are often posted for humorous purposes, to provoke reactions from those unaware that the posted text is a meme.A copypasta is a block of text copied and pasted to the internet and social media. Copypasta containing controversial ideas or lengthy rants are often posted for humorous purposes, to provoke reactions from those unaware that the posted text is a meme.
                    </p>
                </div> 
               

                {/*enable/disable closed captions option*/}
                {/* <Row justify={'start'} style={{paddingTop: '10px', paddingBottom: '10px'}}>
                  <Col offset={1}>
                    <button id='secondary-section-header' style={{width: '5vw'}}>
                      CC on
                    </button>
                  </Col>
                  <Col offset={1}>
                    <button id='secondary-section-header' style={{width: '5vw'}}>
                      CC off
                    </button>
                  </Col>
                  <Col offset={2}>
                    <Dropdown overlay={captions}>
                      <button>
                        Languages
                      </button>
                    </Dropdown>
                  </Col>
                </Row> */}
              </Col>
            </Row>
            {/* Comment Section container */}
            <Row style={{}} justify={'start'}>
              <div id='bottom-container' justify='space-around' style={{maxHeight: '35 vh', maxWidth: '100vw', height: '25vh'}}>
                {/* Comment Blue Header label */}
                <Col id='secondary-section-header' style={{left:"0", fontSize: "medium", width: "15vw", marginLeft: '2.25vw', height: '5vh', paddingTop: '6px'}}>
                  Leave Comment
                </Col>

                {/* =========================================================
                    vvv This is where the comment implementation would go vvv
                    ========================================================= */}
                <div id='container'>
                  <div className='input-wrapper'>
                    <input placeholder='Type Comment' style={{overflowWrap: "break-word"}}/>
                  </div>
                </div>
                <Row justify={'end'}>
                  <button id='secondary-section-header' style={{maxWidth: '5vw', marginRight: '6.5vw', marginTop:'20px'}}>
                    Submit
                  </button>
                </Row>
              </div>
            </Row>
            
          </div>
        </div> 
      </div>
         

      {compileError && (
        <Alert
          message={compileError}
          type='error'
          closable
          onClose={(e) => setCompileError('')}
        ></Alert>
      )}
    </div>
  );
}
