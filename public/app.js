'use strict';
var learnjs = {
  identity_pool_id: 'us-east-1:20b43fc9-eb7b-44b7-8f9d-67987ce51a2a',
  identity: new $.Deferred()
};


learnjs.problems = [
  {
    description: "What is truth?",
    code: "function problem() { return __; }"
  },
  {
    description: "Simple Math",
    code: "function problem() { return 42 === 6 * __; }"
  }
];

learnjs.triggerEvent = function(name, args) {
  $('.view-container>*').trigger(name, args);
};

learnjs.applyObject = function(obj, elem) {
  for (var key in obj) {
    elem.find('[data-name="' + key + '"]').text(obj[key]);
  }
};

learnjs.flashElement = function(elem, content) {
  elem.fadeOut('fast', function() {
    elem.html(content);
    elem.fadeIn();
  });
};

learnjs.template = function(name) {
  return $('.templates .' + name).clone();
};

learnjs.buildCorrectFlash = function(problemNumber) {
  var correctFlash = learnjs.template('correct-flash');
  var link = correctFlash.find('a');
  if (problemNumber < learnjs.problems.length) {
    link.attr('href', '#problem-' + (problemNumber + 1));
  } else {
    link.attr('href', '');
    link.text('You are finished!');
  }
  return correctFlash;
};

learnjs.landingView = function(data) {
  return learnjs.template('landing-view');
};

learnjs.problemView = function(data) {
  var problemNumber = parseInt(data, 10);
  var view = $('.templates .problem-view').clone();
  var problemData = learnjs.problems[problemNumber - 1];
  var resultFlash = view.find('.result');
  var answer = view.find('.answer');

  function checkAnswer() {
    var test = problemData.code.replace('__', answer.val()) + '; problem();';
    return eval(test);
  }

  function checkAnswerClick() {
    displayPopularAnswers();
    if (checkAnswer()) {
      var correctFlash = learnjs.buildCorrectFlash(problemNumber);
      learnjs.flashElement(resultFlash, correctFlash);
      learnjs.saveAnswer(problemNumber, answer.val());
    } else {
      learnjs.flashElement(resultFlash, 'Incorrect!');
    }
    return false;
  }

  function displayPopularAnswers() {
    learnjs.popularAnswers(problemNumber).then(function(data) {
      var v = view.find('.popular-answers');
      var content = learnjs.template('popular-answers-content');
      if (data.StatusCode === 200) {
        content.find('pre code').text(data.Payload);
      } else {
        content.find('pre').text("Failed to fetch popular answers.");
      }
      learnjs.flashElement(v, content);
    });
  }


  if (problemNumber < learnjs.problems.length) {
    var buttonItem = learnjs.template('skip-btn');
    buttonItem.find('a').attr('href', '#problem-' + (problemNumber + 1));
    $('.nav-list').append(buttonItem);
    view.bind('removingView', function() {
      buttonItem.remove();
    });
  }

  learnjs.fetchAnswer(problemNumber).then(function(data) {
    if (data.Item) {
      answer.val(data.Item.answer);
    }
  });

  view.find('.check-btn').click(checkAnswerClick);
  view.find('.title').text('Problem #' + problemNumber);
  learnjs.applyObject(problemData, view);
  return view;
}

learnjs.profileView = function() {
  var view = learnjs.template('profile-view');
  learnjs.identity.done(function(identity) {
    view.find('.email').text(identity.email);
  });
  return view;
}

learnjs.addProfileLink = function(profile) {
  var link = learnjs.template('profile-link');
  link.find('a').text(profile.email);
  $('.signin-bar').prepend(link);
}

learnjs.showView = function(hash) {
  var routes = {
    '#problem': learnjs.problemView,
    '#profile': learnjs.profileView,
    '#': learnjs.landingView,
    '': learnjs.landingView
  };
  var hashParts = hash.split('-');
  var viewFn = routes[hashParts[0]];
  if (viewFn) {
    learnjs.triggerEvent('removingView', []);
    $('.view-container').empty().append(viewFn(hashParts[1]));
  }
}

learnjs.appOnReady = function() {
  window.onhashchange = function() {
    learnjs.showView(window.location.hash);
  };
  learnjs.showView(window.location.hash);
  learnjs.identity.done(learnjs.addProfileLink);
}


function googleSignIn(googleUser) {
  var id_token = googleUser.getAuthResponse().id_token;
  AWS.config.update({
    region: 'us-east-1',
    credentials: new AWS.CognitoIdentityCredentials({
      IdentityPoolId: learnjs.identity_pool_id,
      Logins: {
        'accounts.google.com': id_token
      }
    })
  });

  var refresh = function() {
    return gapi.auth2.getAuthInstance().signIn({
      prompt: 'login'
    }).then(function(userUpdate) {
      var creds = AWS.config.credentials;
      var newToken = userUpdate.getAuthResponse().id_token;
      creds.params.Logins['accounts.google.com'] = newToken;
      return learnjs.awsRefresh();
    });
  };

  learnjs.awsRefresh().then(function(id) {
    learnjs.identity.resolve({
      id: id,
      email: googleUser.getBasicProfile().getEmail(),
      refresh: refresh
    });
  });
}

learnjs.awsRefresh = function() {
  var deferred = new $.Deferred();
  AWS.config.credentials.refresh(function(err) {
    if (err) {
      deferred.reject(err);
    } else {
      deferred.resolve(AWS.config.credentials.identityId);
    }
  });
  return deferred.promise();
}

learnjs.sendAwsRequest = function(req, retry) {
  var promise = new $.Deferred();
  req.on('error', function(error) {
    if (error.code === 'CredentialsError') {
      learnjs.identity.then(function(identity) {
        return identity.refresh().then(function() {
          return retry();
        }, function() {
          promise.reject(resp);
        });
      });
    } else {
      promise.reject(error);
    }
  });
  req.on('success', function(resp) {
    promise.resolve(resp.data);
  });
  req.send();
  return promise;
};

learnjs.saveAnswer = function(problemId, answer) {
  return learnjs.identity.then(function(identity) {
    var db = new AWS.DynamoDB.DocumentClient();
    var item = {
      TableName: 'learnjs',
      Item: {
        userId: identity.id,
        problemId: problemId,
        answer: answer
      }
    };
    return learnjs.sendAwsRequest(db.put(item), function() {
      return learnjs.saveAnswer(problemId, answer);
    });
  });
};

learnjs.fetchAnswer = function(problemId) {
  return learnjs.identity.then(function(identity) {
    var db = new AWS.DynamoDB.DocumentClient();
    var item = {
      TableName: 'learnjs',
      Key: {
        userId: identity.id,
        problemId: problemId
      }
    };
    return learnjs.sendAwsRequest(db.get(item), function() {
      return learnjs.fetchAnswer(problemId);
    });
  });
};

learnjs.countAnswers = function(problemId) {
  return learnjs.identity.then(function(identity) {
    var db = new AWS.DynamoDB.DocumentClient();
    var params = {
      TableName: 'learnjs',
      Select: 'COUNT',
      FilterExpression: 'problemId = :problemId',
      ExpressionAttributeValues: {':problemId': problemId}
    };
    return learnjs.sendAwsRequest(db.scan(params), function() {
      return learnjs.countAnswers(problemId);
    });
  });
};

learnjs.popularAnswers = function(problemId) {
  return learnjs.identity.then(function() {
    var lambda = new AWS.Lambda();
    var params = {
      FunctionName: 'popularAnswers',
      Payload: JSON.stringify({problemNumber: problemId})
    };
    return learnjs.sendAwsRequest(lambda.invoke(params), function() {
      return learnjs.popularAnswers(problemId);
    });
  });
}
